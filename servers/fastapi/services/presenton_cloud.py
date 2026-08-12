from __future__ import annotations

import base64
import hashlib
import uuid
from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.v1.auth.config import get_or_create_auth_secret
from models.sql.presenton_oauth_identity import PresentonOAuthIdentity
from utils.datetime_utils import get_current_utc_datetime
from utils.get_env import get_presenton_oauth_client_id

CLOUD_API_SCOPE = "presenton:api"
TOKEN_REFRESH_SKEW_SECONDS = 60


class PresentonCloudError(RuntimeError):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _token_cipher() -> Fernet:
    secret = get_or_create_auth_secret().encode("utf-8")
    key = hashlib.sha256(b"presenton-oauth-credentials-v1:" + secret).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def _encrypt_token(token: str) -> str:
    return _token_cipher().encrypt(token.encode("utf-8")).decode("utf-8")


def _decrypt_token(token: str | None) -> str | None:
    if not token:
        return None
    try:
        return _token_cipher().decrypt(token.encode("utf-8")).decode("utf-8")
    except (InvalidToken, ValueError) as exc:
        raise PresentonCloudError(
            401,
            "Stored Presenton credentials cannot be decrypted; reconnect the account",
        ) from exc


def _scope_set(value: str | None) -> frozenset[str]:
    return frozenset(part for part in (value or "").split() if part)


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def has_cloud_credentials(identity: PresentonOAuthIdentity | None) -> bool:
    return bool(
        identity
        and identity.access_token_encrypted
        and identity.refresh_token_encrypted
        and CLOUD_API_SCOPE in _scope_set(identity.scopes)
    )


async def get_presenton_identity(
    session: AsyncSession,
    user_id: uuid.UUID,
    issuer: str,
    *,
    for_update: bool = False,
) -> PresentonOAuthIdentity | None:
    statement = select(PresentonOAuthIdentity).where(
        PresentonOAuthIdentity.user_id == user_id,
        PresentonOAuthIdentity.issuer == issuer,
    )
    if for_update:
        statement = statement.with_for_update()
    return await session.scalar(statement)


async def store_presenton_credentials(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    issuer: str,
    access_token: str,
    refresh_token: str,
    scope: str,
    expires_in: int,
) -> PresentonOAuthIdentity:
    if CLOUD_API_SCOPE not in _scope_set(scope):
        raise PresentonCloudError(
            403,
            "Presenton did not grant cloud presentation access",
        )
    identity = await get_presenton_identity(session, user_id, issuer, for_update=True)
    if identity is None:
        raise PresentonCloudError(409, "The Presenton account is not linked")

    identity.access_token_encrypted = _encrypt_token(access_token)
    identity.refresh_token_encrypted = _encrypt_token(refresh_token)
    identity.token_expires_at = get_current_utc_datetime() + timedelta(
        seconds=max(1, expires_in)
    )
    identity.scopes = " ".join(sorted(_scope_set(scope)))
    session.add(identity)
    await session.commit()
    await session.refresh(identity)
    return identity


def _response_json(response: httpx.Response) -> dict[str, Any]:
    try:
        payload = response.json()
    except ValueError:
        return {}
    return payload if isinstance(payload, dict) else {}


def _response_detail(response: httpx.Response, fallback: str) -> str:
    payload = _response_json(response)
    for key in ("error_description", "detail", "error"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return fallback


async def _refresh_access_token(
    session: AsyncSession,
    identity: PresentonOAuthIdentity,
) -> tuple[str, PresentonOAuthIdentity]:
    refresh_token = _decrypt_token(identity.refresh_token_encrypted)
    if not refresh_token:
        raise PresentonCloudError(401, "Reconnect your Presenton account")

    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(20.0),
            follow_redirects=False,
        ) as client:
            response = await client.post(
                f"{identity.issuer}/oauth/token",
                data={
                    "grant_type": "refresh_token",
                    "client_id": get_presenton_oauth_client_id(),
                    "refresh_token": refresh_token,
                },
            )
    except httpx.HTTPError as exc:
        raise PresentonCloudError(
            502,
            "Could not refresh the Presenton cloud session",
        ) from exc

    if not response.is_success:
        identity.access_token_encrypted = None
        identity.refresh_token_encrypted = None
        identity.token_expires_at = None
        identity.scopes = None
        session.add(identity)
        await session.commit()
        raise PresentonCloudError(
            401,
            _response_detail(response, "Presenton authorization expired; reconnect"),
        )

    payload = _response_json(response)
    access_token = payload.get("access_token")
    rotated_refresh_token = payload.get("refresh_token")
    scope = payload.get("scope")
    expires_in = payload.get("expires_in")
    if (
        not isinstance(access_token, str)
        or not access_token
        or not isinstance(rotated_refresh_token, str)
        or not rotated_refresh_token
        or not isinstance(scope, str)
        or CLOUD_API_SCOPE not in _scope_set(scope)
    ):
        raise PresentonCloudError(
            502,
            "Presenton returned an invalid refreshed session",
        )

    identity.access_token_encrypted = _encrypt_token(access_token)
    identity.refresh_token_encrypted = _encrypt_token(rotated_refresh_token)
    identity.token_expires_at = get_current_utc_datetime() + timedelta(
        seconds=expires_in if isinstance(expires_in, int) and expires_in > 0 else 3600
    )
    identity.scopes = " ".join(sorted(_scope_set(scope)))
    session.add(identity)
    await session.commit()
    await session.refresh(identity)
    return access_token, identity


async def get_valid_presenton_access_token(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    issuer: str,
    force_refresh: bool = False,
) -> tuple[str, PresentonOAuthIdentity]:
    identity = await get_presenton_identity(session, user_id, issuer, for_update=True)
    if not has_cloud_credentials(identity):
        raise PresentonCloudError(401, "Connect your Presenton account first")
    assert identity is not None

    now = get_current_utc_datetime()
    expires_at = identity.token_expires_at
    if (
        not force_refresh
        and expires_at is not None
        and _as_utc(expires_at)
        > _as_utc(now) + timedelta(seconds=TOKEN_REFRESH_SKEW_SECONDS)
    ):
        access_token = _decrypt_token(identity.access_token_encrypted)
        if access_token:
            return access_token, identity
    return await _refresh_access_token(session, identity)


async def open_presenton_cloud_response(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    issuer: str,
    method: str,
    path: str,
    query_string: str = "",
    headers: Mapping[str, str] | None = None,
    content: bytes | None = None,
) -> tuple[httpx.AsyncClient, httpx.Response]:
    """Open a streaming cloud response while preserving the original API request."""
    access_token, _identity = await get_valid_presenton_access_token(
        session,
        user_id=user_id,
        issuer=issuer,
    )
    url = f"{issuer}{path}"
    if query_string:
        url = f"{url}?{query_string}"

    async def send(token: str) -> tuple[httpx.AsyncClient, httpx.Response]:
        client = httpx.AsyncClient(
            timeout=httpx.Timeout(15 * 60.0),
            follow_redirects=False,
        )
        outbound_headers = dict(headers or {})
        outbound_headers["Authorization"] = f"Bearer {token}"
        try:
            request = client.build_request(
                method,
                url,
                headers=outbound_headers,
                content=content,
            )
            response = await client.send(request, stream=True)
            return client, response
        except httpx.HTTPError as exc:
            await client.aclose()
            raise PresentonCloudError(
                502,
                "Could not connect to the Presenton cloud API",
            ) from exc

    client, response = await send(access_token)
    if response.status_code != 401:
        return client, response

    await response.aclose()
    await client.aclose()
    refreshed_token, _identity = await get_valid_presenton_access_token(
        session,
        user_id=user_id,
        issuer=issuer,
        force_refresh=True,
    )
    return await send(refreshed_token)


async def revoke_and_delete_presenton_identity(
    session: AsyncSession,
    identity: PresentonOAuthIdentity,
    provider_request: Callable[..., Awaitable[httpx.Response]] | None = None,
) -> None:
    refresh_token: str | None
    try:
        refresh_token = _decrypt_token(identity.refresh_token_encrypted)
    except PresentonCloudError:
        refresh_token = None

    if refresh_token:
        try:
            if provider_request is not None:
                await provider_request(
                    "POST",
                    f"{identity.issuer}/oauth/revoke",
                    data={
                        "token": refresh_token,
                        "token_type_hint": "refresh_token",
                    },
                )
            else:
                async with httpx.AsyncClient(
                    timeout=httpx.Timeout(15.0),
                    follow_redirects=False,
                ) as client:
                    await client.post(
                        f"{identity.issuer}/oauth/revoke",
                        data={
                            "token": refresh_token,
                            "token_type_hint": "refresh_token",
                        },
                    )
        except httpx.HTTPError:
            pass

    await session.delete(identity)
    await session.commit()
