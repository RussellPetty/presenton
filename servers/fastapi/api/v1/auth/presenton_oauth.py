from __future__ import annotations

import hashlib
import secrets
from typing import Any

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import JSONResponse, Response

from api.v1.auth.users import (
    PASSWORD_HELPER,
    get_current_user,
    get_jwt_strategy,
    read_user_from_cookie,
    serialize_user,
)
from models.sql.presenton_oauth_identity import PresentonOAuthIdentity
from models.sql.user import User
from services.database import get_async_session
from services.presenton_cloud import (
    PresentonCloudError,
    has_cloud_credentials,
    request_presenton_cloud,
    revoke_and_delete_presenton_identity,
    store_presenton_credentials,
)
from utils.get_env import (
    get_presenton_oauth_client_id,
    get_presenton_oauth_issuer,
)

PRESENTON_OAUTH_ROUTER = APIRouter(prefix="/presenton", tags=["Presenton Login"])
DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"
NO_STORE_HEADERS = {"Cache-Control": "no-store", "Pragma": "no-cache"}


class PresentonDeviceStartRequest(BaseModel):
    device_name: str | None = Field(default=None, max_length=120)


class PresentonDevicePollRequest(BaseModel):
    device_code: str = Field(min_length=16, max_length=512)
    link_current_user: bool = False


class PresentonUserInfo(BaseModel):
    sub: str = Field(min_length=1, max_length=255)
    email: str = Field(min_length=3, max_length=320)
    name: str | None = Field(default=None, max_length=255)
    picture: str | None = None


def _oauth_config() -> tuple[str, str]:
    return get_presenton_oauth_issuer(), get_presenton_oauth_client_id()


async def _provider_request(
    method: str,
    url: str,
    **kwargs: Any,
) -> httpx.Response:
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(15.0),
        follow_redirects=False,
    ) as client:
        return await client.request(method, url, **kwargs)


def _provider_json(response: httpx.Response) -> dict[str, Any]:
    try:
        payload = response.json()
    except ValueError:
        return {}
    return payload if isinstance(payload, dict) else {}


def _provider_error(payload: dict[str, Any], fallback: str) -> str:
    description = payload.get("error_description")
    if isinstance(description, str) and description.strip():
        return description
    detail = payload.get("detail")
    if isinstance(detail, str) and detail.strip():
        return detail
    return fallback


def _cloud_response(response: httpx.Response) -> Response:
    content_type = response.headers.get("content-type", "application/json")
    return Response(
        content=response.content,
        status_code=response.status_code,
        media_type=content_type.split(";", 1)[0],
        headers=NO_STORE_HEADERS,
    )


async def _request_cloud_for_user(
    session: AsyncSession,
    user: User,
    method: str,
    path: str,
    **kwargs: Any,
) -> httpx.Response:
    try:
        return await request_presenton_cloud(
            session,
            user_id=user.id,
            issuer=get_presenton_oauth_issuer(),
            method=method,
            path=path,
            **kwargs,
        )
    except PresentonCloudError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


def _secure_request(request: Request) -> bool:
    return (
        request.headers.get("x-forwarded-proto", "").lower() == "https"
        or request.url.scheme == "https"
    )


def _set_session_cookie(response: JSONResponse, token: str, request: Request) -> None:
    from api.v1.auth.config import SESSION_COOKIE_NAME, SESSION_TTL_SECONDS

    response.set_cookie(
        SESSION_COOKIE_NAME,
        token,
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        secure=_secure_request(request),
        samesite="lax",
        path="/",
    )


def _fallback_username(email: str, subject: str) -> str:
    normalized_email = email.strip().casefold()
    if normalized_email and not any(
        character.isspace() for character in normalized_email
    ):
        return normalized_email[:128]
    subject_digest = hashlib.sha256(subject.encode("utf-8")).hexdigest()[:12]
    return f"presenton-{subject_digest}"


async def _available_username(
    session: AsyncSession,
    email: str,
    subject: str,
) -> str:
    preferred = _fallback_username(email, subject)
    existing = await session.scalar(
        select(User.id).where(func.lower(User.username) == preferred.casefold())
    )
    if existing is None:
        return preferred

    digest = hashlib.sha256(subject.encode("utf-8")).hexdigest()[:10]
    local_part = preferred.split("@", 1)[0][:100].rstrip("-._") or "presenton"
    candidate = f"{local_part}-presenton-{digest}"[:128]
    suffix = 1
    while await session.scalar(
        select(User.id).where(func.lower(User.username) == candidate.casefold())
    ):
        suffix += 1
        suffix_text = f"-{suffix}"
        candidate = f"{local_part[: 128 - len(suffix_text)]}{suffix_text}"
    return candidate


async def _resolve_local_user(
    session: AsyncSession,
    issuer: str,
    profile: PresentonUserInfo,
    link_user: User | None = None,
) -> User:
    identity = await session.scalar(
        select(PresentonOAuthIdentity).where(
            PresentonOAuthIdentity.issuer == issuer,
            PresentonOAuthIdentity.subject == profile.sub,
        )
    )
    if identity is not None:
        if link_user is not None and identity.user_id != link_user.id:
            raise HTTPException(
                status_code=409,
                detail="This Presenton account is already linked to another local user",
            )
        user = await session.get(User, identity.user_id)
        if user is None or not user.is_active:
            raise HTTPException(
                status_code=403, detail="This local account is disabled"
            )
        if identity.email != profile.email:
            identity.email = profile.email
            session.add(identity)
            await session.commit()
        return user

    if link_user is not None:
        existing_link = await session.scalar(
            select(PresentonOAuthIdentity).where(
                PresentonOAuthIdentity.user_id == link_user.id
            )
        )
        if existing_link is not None:
            raise HTTPException(
                status_code=409,
                detail="This local user is already linked to another Presenton account",
            )
        if not link_user.is_active:
            raise HTTPException(
                status_code=403, detail="This local account is disabled"
            )
        session.add(
            PresentonOAuthIdentity(
                user_id=link_user.id,
                issuer=issuer,
                subject=profile.sub,
                email=profile.email,
            )
        )
        await session.commit()
        return link_user

    is_first_user = (
        int(await session.scalar(select(func.count()).select_from(User)) or 0) == 0
    )
    username = await _available_username(session, profile.email, profile.sub)
    user = User(
        username=username,
        hashed_password=PASSWORD_HELPER.hash(secrets.token_urlsafe(48)),
        is_active=True,
        is_verified=True,
        is_superuser=is_first_user,
        admin_slot="primary" if is_first_user else None,
        auth_version=1,
    )
    session.add(user)
    await session.flush()
    session.add(
        PresentonOAuthIdentity(
            user_id=user.id,
            issuer=issuer,
            subject=profile.sub,
            email=profile.email,
        )
    )
    await session.commit()
    await session.refresh(user)
    return user


async def _best_effort_revoke(issuer: str, refresh_token: str | None) -> None:
    if not refresh_token:
        return
    try:
        await _provider_request(
            "POST",
            f"{issuer}/oauth/revoke",
            data={"token": refresh_token, "token_type_hint": "refresh_token"},
        )
    except httpx.HTTPError:
        pass


@PRESENTON_OAUTH_ROUTER.get("/status")
async def presenton_login_status(
    session: AsyncSession = Depends(get_async_session),
    current_user: User | None = Depends(read_user_from_cookie),
):
    issuer = get_presenton_oauth_issuer()
    identity = None
    if current_user is not None:
        identity = await session.scalar(
            select(PresentonOAuthIdentity).where(
                PresentonOAuthIdentity.user_id == current_user.id,
                PresentonOAuthIdentity.issuer == issuer,
            )
        )
    return {
        "enabled": True,
        "issuer": issuer,
        "linked": has_cloud_credentials(identity),
        "identity_linked": identity is not None,
        "cloud_generation_enabled": has_cloud_credentials(identity),
        "email": identity.email if identity is not None else None,
        "scopes": sorted((identity.scopes or "").split()) if identity else [],
    }


@PRESENTON_OAUTH_ROUTER.post("/logout")
async def logout_presenton_account(
    session: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user),
):
    issuer = get_presenton_oauth_issuer()
    identity = await session.scalar(
        select(PresentonOAuthIdentity).where(
            PresentonOAuthIdentity.user_id == current_user.id,
            PresentonOAuthIdentity.issuer == issuer,
        )
    )
    if identity is not None:
        await revoke_and_delete_presenton_identity(
            session,
            identity,
            provider_request=_provider_request,
        )
    return {"detail": "Disconnected from Presenton successfully"}


@PRESENTON_OAUTH_ROUTER.post("/cloud/presentation/generate")
async def generate_presentation_in_cloud(
    body: dict[str, Any],
    session: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user),
):
    response = await _request_cloud_for_user(
        session,
        current_user,
        "POST",
        "/api/v3/presentation/generate",
        json=body,
    )
    return _cloud_response(response)


@PRESENTON_OAUTH_ROUTER.post("/cloud/presentation/generate/async")
async def generate_presentation_in_cloud_async(
    body: dict[str, Any],
    session: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user),
):
    response = await _request_cloud_for_user(
        session,
        current_user,
        "POST",
        "/api/v3/presentation/generate/async",
        json=body,
    )
    return _cloud_response(response)


@PRESENTON_OAUTH_ROUTER.get("/cloud/async-task/status/{task_id}")
async def get_cloud_generation_status(
    task_id: str,
    session: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user),
):
    response = await _request_cloud_for_user(
        session,
        current_user,
        "GET",
        f"/api/v3/async-task/status/{task_id}",
    )
    return _cloud_response(response)


@PRESENTON_OAUTH_ROUTER.post("/cloud/files/upload")
async def upload_files_to_presenton_cloud(
    files: list[UploadFile] = File(...),
    session: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user),
):
    upload_parts = [
        (
            "files",
            (
                uploaded.filename or "upload",
                uploaded.file,
                uploaded.content_type or "application/octet-stream",
            ),
        )
        for uploaded in files
    ]
    response = await _request_cloud_for_user(
        session,
        current_user,
        "POST",
        "/api/v3/files/upload",
        files=upload_parts,
    )
    return _cloud_response(response)


@PRESENTON_OAUTH_ROUTER.post("/device/start")
async def start_presenton_device_login(body: PresentonDeviceStartRequest):
    issuer, client_id = _oauth_config()
    try:
        response = await _provider_request(
            "POST",
            f"{issuer}/oauth/device_authorization",
            data={
                "client_id": client_id,
                "scope": "presenton:api profile:read",
                "device_name": (body.device_name or "Presenton self-hosted")[:120],
            },
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail="Could not connect to the Presenton authorization service",
        ) from exc

    payload = _provider_json(response)
    if not response.is_success:
        raise HTTPException(
            status_code=502 if response.status_code >= 500 else response.status_code,
            detail=_provider_error(payload, "Could not start Presenton login"),
        )
    required = {
        "device_code",
        "user_code",
        "verification_uri",
        "verification_uri_complete",
        "expires_in",
        "interval",
    }
    if not required.issubset(payload):
        raise HTTPException(
            status_code=502,
            detail="Presenton returned an invalid device authorization response",
        )
    return JSONResponse(payload, headers=NO_STORE_HEADERS)


@PRESENTON_OAUTH_ROUTER.post("/device/poll")
async def poll_presenton_device_login(
    body: PresentonDevicePollRequest,
    request: Request,
    session: AsyncSession = Depends(get_async_session),
    current_user: User | None = Depends(read_user_from_cookie),
):
    issuer, client_id = _oauth_config()
    try:
        token_response = await _provider_request(
            "POST",
            f"{issuer}/oauth/token",
            data={
                "grant_type": DEVICE_GRANT_TYPE,
                "client_id": client_id,
                "device_code": body.device_code,
            },
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail="Could not connect to the Presenton authorization service",
        ) from exc

    token_payload = _provider_json(token_response)
    if not token_response.is_success:
        oauth_error = token_payload.get("error")
        if oauth_error in {"authorization_pending", "slow_down"}:
            return JSONResponse(
                status_code=202,
                content={"status": "pending", "error": oauth_error},
                headers=NO_STORE_HEADERS,
            )
        raise HTTPException(
            status_code=400 if token_response.status_code < 500 else 502,
            detail=_provider_error(token_payload, "Presenton login failed"),
        )

    access_token = token_payload.get("access_token")
    refresh_token = token_payload.get("refresh_token")
    granted_scope = token_payload.get("scope")
    expires_in = token_payload.get("expires_in")
    if not isinstance(access_token, str) or not access_token:
        raise HTTPException(
            status_code=502, detail="Presenton did not return an access token"
        )

    refresh_token_value = refresh_token if isinstance(refresh_token, str) else None
    if not refresh_token_value:
        raise HTTPException(
            status_code=502, detail="Presenton did not return a refresh token"
        )
    if not isinstance(granted_scope, str):
        raise HTTPException(status_code=502, detail="Presenton did not return scopes")
    expires_in_value = expires_in if isinstance(expires_in, int) else 3600
    credentials_stored = False
    try:
        try:
            userinfo_response = await _provider_request(
                "GET",
                f"{issuer}/oauth/userinfo",
                headers={"Authorization": f"Bearer {access_token}"},
            )
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=502,
                detail="Could not verify the Presenton account",
            ) from exc
        userinfo_payload = _provider_json(userinfo_response)
        if not userinfo_response.is_success:
            raise HTTPException(
                status_code=502, detail="Could not verify the Presenton account"
            )
        try:
            profile = PresentonUserInfo.model_validate(userinfo_payload)
        except ValueError as exc:
            raise HTTPException(
                status_code=502,
                detail="Presenton returned an invalid user profile",
            ) from exc

        if body.link_current_user and current_user is None:
            raise HTTPException(
                status_code=401,
                detail="A local session is required to link a Presenton account",
            )
        user = await _resolve_local_user(
            session,
            issuer,
            profile,
            link_user=current_user if body.link_current_user else None,
        )
        try:
            await store_presenton_credentials(
                session,
                user_id=user.id,
                issuer=issuer,
                access_token=access_token,
                refresh_token=refresh_token_value,
                scope=granted_scope,
                expires_in=expires_in_value,
            )
        except PresentonCloudError as exc:
            raise HTTPException(
                status_code=exc.status_code,
                detail=exc.detail,
            ) from exc
        credentials_stored = True
        token = await get_jwt_strategy().write_token(user)
        response = JSONResponse(
            {
                "status": "authorized",
                "configured": True,
                "authenticated": True,
                **serialize_user(user),
                "provider": "presenton",
            },
            headers=NO_STORE_HEADERS,
        )
        _set_session_cookie(response, token, request)
        return response
    finally:
        if not credentials_stored:
            await _best_effort_revoke(issuer, refresh_token_value)
