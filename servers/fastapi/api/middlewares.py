import hmac

from fastapi import Request
from starlette.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.concurrency import run_in_threadpool

from utils.clerk_auth import verify_clerk_token
from utils.get_env import (
    get_can_change_keys_env,
    get_internal_api_secret_env,
    is_clerk_auth_enabled,
    is_disable_auth_enabled,
)
from utils.simple_auth import (
    get_auth_status,
    get_basic_auth_credentials_from_request,
    get_bearer_token_from_request,
    get_session_token_from_request,
    verify_credentials,
)
from utils.user_config import update_env_with_user_config


# Synthetic identity for trusted internal service-to-service calls (MCP, export
# renderer, template SSR) that present INTERNAL_API_SECRET but carry no Clerk user.
INTERNAL_SERVICE_USER_ID = "__internal_service__"
# Header an internal caller may set alongside the secret to act as a specific
# user (e.g. the export renderer re-fetching a deck on its owner's behalf).
INTERNAL_USER_ID_HEADER = "X-Presenton-User-Id"


class UserConfigEnvUpdateMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if get_can_change_keys_env() != "false":
            update_env_with_user_config()
        return await call_next(request)


class SessionAuthMiddleware(BaseHTTPMiddleware):
    _EXEMPT_PREFIXES = (
        "/api/v1/auth/",
    )
    _PROTECTED_NON_API_PATHS = {
        "/docs",
        "/openapi.json",
        "/redoc",
    }

    def _is_exempt(self, path: str) -> bool:
        return any(path.startswith(prefix) for prefix in self._EXEMPT_PREFIXES)

    def _requires_auth(self, path: str) -> bool:
        if path.startswith("/api/"):
            return True
        # PPTX export may re-fetch slide images without session/basic headers.
        if path.startswith("/app_data/images/"):
            return False
        if path.startswith("/app_data/"):
            return True
        return path in self._PROTECTED_NON_API_PATHS

    async def dispatch(self, request: Request, call_next):
        if is_disable_auth_enabled():
            return await call_next(request)

        path = request.url.path

        if (
            request.method == "OPTIONS"
            or not self._requires_auth(path)
            or self._is_exempt(path)
        ):
            return await call_next(request)

        if is_clerk_auth_enabled():
            return await self._dispatch_clerk(request, call_next)

        return await self._dispatch_single_user(request, call_next)

    async def _dispatch_clerk(self, request: Request, call_next):
        token = get_bearer_token_from_request(request)
        if not token:
            return JSONResponse(status_code=401, content={"detail": "Unauthorized"})

        # Trusted internal service-to-service calls present the shared secret
        # instead of a Clerk user token, and may impersonate a specific user.
        internal_secret = get_internal_api_secret_env()
        if internal_secret and hmac.compare_digest(token, internal_secret):
            impersonated = (request.headers.get(INTERNAL_USER_ID_HEADER) or "").strip()
            user_id = impersonated or INTERNAL_SERVICE_USER_ID
            request.state.external_user_id = user_id
            request.state.auth_username = user_id
            request.state.is_internal_service = True
            return await call_next(request)

        # Verify off the event loop: the first call per `kid` fetches JWKS.
        external_user_id = await run_in_threadpool(verify_clerk_token, token)
        if not external_user_id:
            return JSONResponse(status_code=401, content={"detail": "Unauthorized"})

        request.state.external_user_id = external_user_id
        request.state.auth_username = external_user_id
        return await call_next(request)

    async def _dispatch_single_user(self, request: Request, call_next):
        auth_status = get_auth_status(get_session_token_from_request(request))
        if not auth_status["configured"]:
            return JSONResponse(
                status_code=428,
                content={
                    "detail": "Login setup is required",
                    "setup_required": True,
                },
            )

        if not auth_status["authenticated"]:
            basic_credentials = get_basic_auth_credentials_from_request(request)
            if basic_credentials and verify_credentials(
                basic_credentials[0], basic_credentials[1]
            ):
                request.state.auth_username = basic_credentials[0].strip()
                return await call_next(request)

            return JSONResponse(
                status_code=401,
                content={"detail": "Unauthorized"},
            )

        request.state.auth_username = auth_status.get("username")
        return await call_next(request)
