from dataclasses import dataclass
from typing import Literal
import re
import secrets
import uuid

from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.v1.auth.users import (
    PASSWORD_HELPER,
    UsernameUserDatabase,
    UserManager,
    get_jwt_strategy,
)
from models.sql.access_token import AccessToken
from models.sql.user import User
from api.v1.auth.config import SESSION_COOKIE_NAME
from utils.clerk_auth import verify_clerk_token
from utils.get_env import get_internal_api_secret_env, is_clerk_auth_enabled


@dataclass(frozen=True)
class AuthPrincipal:
    user_id: uuid.UUID
    username: str
    is_admin: bool
    method: Literal["jwt", "api_key"]


# Clerk-backed accounts are namespaced so a Clerk subject can never bind to a
# locally created username (which could be a superuser). The prefix is not a
# valid local username, so the two spaces cannot overlap.
CLERK_USERNAME_PREFIX = "clerk:"
INTERNAL_SERVICE_SUBJECT = "__internal_service__"


def _clerk_username(clerk_sub: str) -> str:
    return f"{CLERK_USERNAME_PREFIX}{clerk_sub.strip()}"


async def _find_or_create_clerk_user(
    session: AsyncSession, clerk_sub: str
) -> User | None:
    """Map a Clerk subject onto a User row so owner_id scoping applies unchanged.

    Auto-provisions on first sight. The password is random and unusable: these
    accounts are never reachable through the username/password login route."""
    username = _clerk_username(clerk_sub)
    if len(username) > 128:
        return None

    statement = select(User).where(User.username == username)
    user = (await session.execute(statement)).unique().scalar_one_or_none()
    if user is not None:
        return user if user.is_active else None

    user = User(
        username=username,
        hashed_password=PASSWORD_HELPER.hash(secrets.token_urlsafe(32)),
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    session.add(user)
    try:
        await session.commit()
    except IntegrityError:
        # Concurrent first-request for the same subject; re-read the winner.
        await session.rollback()
        user = (await session.execute(statement)).unique().scalar_one_or_none()
        return user if user is not None and user.is_active else None
    await session.refresh(user)
    return user


# EventSource cannot set request headers, so the streaming endpoints — and only
# those — accept the token in the query string. Keeping this narrow matters: a
# query parameter is recorded by access logs, proxies and browser history in a
# way an Authorization header is not, so it must not be a general-purpose way to
# authenticate every endpoint.
_SSE_PATH_RE = re.compile(r"^/api/v\d+/ppt/(?:outlines|presentation)/stream/[^/]+/?$")


def _token_in_query_allowed(request: Request) -> bool:
    return bool(_SSE_PATH_RE.match(request.url.path))


def _bearer_token(request: Request) -> str | None:
    authorization = request.headers.get("Authorization", "")
    if authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        return token or None
    if not _token_in_query_allowed(request):
        return None
    token = request.query_params.get("token")
    return token.strip() if token and token.strip() else None


async def _session_cookie_principal(
    request: Request, session: AsyncSession
) -> tuple[AuthPrincipal | None, User | None]:
    """Authenticate the app's own session cookie.

    In Clerk mode this is not a user-facing login path. The only legitimate
    issuer is the server itself, minting a token so the headless export renderer
    can fetch the deck it is rendering as that deck's owner.

    Two restrictions keep it from becoming a second, weaker way in:

    * only Clerk-provisioned accounts are accepted, so a local account that
      predates the switch to Clerk mode (or is created by any future code path)
      can never authenticate here; and
    * it never carries admin, so even a mis-provisioned superuser row cannot
      reach the admin-gated routes through a cookie.
    """
    cookie_token = request.cookies.get(SESSION_COOKIE_NAME)
    if not cookie_token:
        return None, None
    user_db = UsernameUserDatabase(session)
    user = await get_jwt_strategy().read_token(cookie_token, UserManager(user_db))
    if user is None:
        return None, None
    if not user.username.startswith(CLERK_USERNAME_PREFIX):
        return None, None
    return (
        AuthPrincipal(
            user_id=user.id,
            username=user.username,
            is_admin=False,
            method="jwt",
        ),
        user,
    )


async def _resolve_clerk_principal(
    request: Request, session: AsyncSession
) -> tuple[AuthPrincipal | None, User | None]:
    token = _bearer_token(request)
    if not token:
        # No bearer: the only remaining caller is the export renderer carrying a
        # server-minted session cookie. Checked last so a stale cookie can never
        # outrank the embedder's token.
        return await _session_cookie_principal(request, session)

    internal_secret = get_internal_api_secret_env()
    if internal_secret and secrets.compare_digest(token, internal_secret):
        # Trusted service-to-service call (export renderer, MCP). It may act as
        # a specific user via X-Presenton-User-Id; otherwise it gets its own
        # isolated service account.
        impersonated = (request.headers.get("X-Presenton-User-Id") or "").strip()
        subject = impersonated or INTERNAL_SERVICE_SUBJECT
        user = await _find_or_create_clerk_user(session, subject)
        if user is None:
            return None, None
        return (
            AuthPrincipal(
                user_id=user.id,
                username=user.username,
                # Acting as a specific user must not confer more than that user
                # has; only the unimpersonated service account is administrative.
                is_admin=not impersonated,
                method="jwt",
            ),
            user,
        )

    clerk_sub = verify_clerk_token(token) if token else None
    if not clerk_sub:
        return None, None
    if clerk_sub == INTERNAL_SERVICE_SUBJECT:
        # A real Clerk subject can never be this literal; refuse defensively so
        # a forged token can never land on the privileged service account.
        return None, None
    user = await _find_or_create_clerk_user(session, clerk_sub)
    if user is None:
        return None, None
    return (
        AuthPrincipal(
            user_id=user.id,
            username=user.username,
            is_admin=False,
            method="jwt",
        ),
        user,
    )


async def resolve_request_principal(
    request: Request, session: AsyncSession
) -> tuple[AuthPrincipal | None, User | None]:
    if is_clerk_auth_enabled():
        # Clerk mode is exclusive: the local cookie/api-key paths stay off so a
        # stale session cookie can never outrank the embedder's token.
        return await _resolve_clerk_principal(request, session)

    cookie_token = request.cookies.get(SESSION_COOKIE_NAME)
    if cookie_token:
        user_db = UsernameUserDatabase(session)
        user = await get_jwt_strategy().read_token(cookie_token, UserManager(user_db))
        if user:
            return (
                AuthPrincipal(
                    user_id=user.id,
                    username=user.username,
                    is_admin=user.is_superuser,
                    method="jwt",
                ),
                user,
            )

    authorization = request.headers.get("Authorization", "")
    if authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        if not token.startswith("sk-presenton-"):
            return None, None
        access_token = await session.get(AccessToken, token)
        if access_token is None:
            return None, None
        user = await session.get(User, access_token.user_id)
        if user is None or not user.is_active or not user.is_superuser:
            return None, None
        return (
            AuthPrincipal(
                user_id=user.id,
                username=user.username,
                is_admin=True,
                method="api_key",
            ),
            user,
        )

    return None, None


def principal_from_request(request: Request) -> AuthPrincipal:
    principal = getattr(request.state, "auth_principal", None)
    if principal is None:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return principal


def require_browser_admin_principal(request: Request) -> AuthPrincipal:
    principal = principal_from_request(request)
    if principal.method != "jwt" or not principal.is_admin:
        raise HTTPException(status_code=403, detail="Admin browser session required")
    return principal
