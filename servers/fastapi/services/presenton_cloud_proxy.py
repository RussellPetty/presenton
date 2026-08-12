from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import JSONResponse, Response, StreamingResponse

from api.v1.auth.assets import normalized_app_data_parts
from models.sql.presenton_cloud_provider import PresentonCloudProvider
from models.sql.user import User
from services.presenton_cloud import (
    PresentonCloudError,
    get_presenton_provider,
    has_cloud_credentials,
    open_presenton_cloud_response,
)
from utils.get_env import get_presenton_oauth_issuer

CLOUD_PPT_PATH_PREFIXES = (
    "/api/v1/ppt/files/",
    "/api/v1/ppt/outlines/",
    "/api/v1/ppt/presentation/",
    "/api/v1/ppt/slide/",
    "/api/v1/ppt/images/",
    "/api/v1/ppt/icons/",
    "/api/v1/ppt/themes/",
    "/api/v1/ppt/theme/",
    "/api/v1/ppt/chat/",
    "/api/v1/ppt/template/",
    "/api/v1/ppt/community/",
)
CLOUD_PRIVATE_ASSET_PATH_PREFIXES = (
    "/app_data/images/",
    "/app_data/exports/",
    "/app_data/uploads/",
    "/app_data/pptx-to-html/",
    "/app_data/pptx-to-json/",
)
_HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}
_REQUEST_HEADERS_TO_DROP = _HOP_BY_HOP_HEADERS | {
    "authorization",
    "content-length",
    "cookie",
    "host",
}
_RESPONSE_HEADERS_TO_DROP = _HOP_BY_HOP_HEADERS | {
    "content-length",
    "set-cookie",
}


def should_proxy_presenton_cloud(path: str) -> bool:
    return path.startswith(
        CLOUD_PPT_PATH_PREFIXES + CLOUD_PRIVATE_ASSET_PATH_PREFIXES
    )


def _cloud_asset_belongs_to_provider(
    path: str,
    provider: PresentonCloudProvider,
) -> bool:
    if not path.startswith(CLOUD_PRIVATE_ASSET_PATH_PREFIXES):
        return True
    parts = normalized_app_data_parts(path)
    if not parts or len(parts) < 4 or parts[1] != "users":
        return False
    try:
        return uuid.UUID(parts[2]) == uuid.UUID(provider.subject)
    except (TypeError, ValueError):
        return False


def _forward_request_headers(request: Request) -> dict[str, str]:
    return {
        key: value
        for key, value in request.headers.items()
        if key.lower() not in _REQUEST_HEADERS_TO_DROP
    }


def _forward_response_headers(headers) -> dict[str, str]:
    return {
        key: value
        for key, value in headers.items()
        if key.lower() not in _RESPONSE_HEADERS_TO_DROP
    }


async def maybe_proxy_presenton_cloud_request(
    request: Request,
    session: AsyncSession,
    user: User | None,
) -> Response | None:
    if user is None or not should_proxy_presenton_cloud(request.url.path):
        return None

    issuer = get_presenton_oauth_issuer()
    provider = await get_presenton_provider(session, issuer)
    if not has_cloud_credentials(provider):
        return None
    assert provider is not None
    if not _cloud_asset_belongs_to_provider(request.url.path, provider):
        return None

    try:
        client, upstream = await open_presenton_cloud_response(
            session,
            issuer=issuer,
            method=request.method,
            path=request.url.path,
            query_string=request.url.query,
            headers=_forward_request_headers(request),
            content=await request.body(),
        )
    except PresentonCloudError as exc:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    async def stream_body() -> AsyncIterator[bytes]:
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(
        stream_body(),
        status_code=upstream.status_code,
        headers=_forward_response_headers(upstream.headers),
    )
