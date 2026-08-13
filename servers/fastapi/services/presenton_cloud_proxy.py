from __future__ import annotations

import json
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
from services.presenton_cloud_persistence import (
    persist_cloud_presentation_complete,
    persist_cloud_presentation_created,
)
from services.provider_settings import get_provider_settings
from utils.get_env import get_presenton_oauth_issuer

CLOUD_GENERATION_PATHS = frozenset(
    {
        "/api/v1/ppt/files/upload",
        "/api/v1/ppt/files/decompose",
        "/api/v1/ppt/presentation/create",
        "/api/v1/ppt/presentation/prepare",
    }
)
CLOUD_GENERATION_PATH_PREFIXES = (
    "/api/v1/ppt/outlines/stream/",
    "/api/v1/ppt/presentation/stream/",
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
    return (
        path in CLOUD_GENERATION_PATHS
        or path.startswith(
            CLOUD_GENERATION_PATH_PREFIXES + CLOUD_PRIVATE_ASSET_PATH_PREFIXES
        )
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


def _json_object(value: bytes) -> dict | None:
    try:
        payload = json.loads(value)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _complete_presentations_from_sse(buffer: bytearray) -> list[dict]:
    presentations: list[dict] = []
    while True:
        boundary = buffer.find(b"\n\n")
        if boundary == -1:
            break
        frame = bytes(buffer[:boundary]).replace(b"\r\n", b"\n")
        del buffer[: boundary + 2]
        data = b"\n".join(
            line[6:] for line in frame.splitlines() if line.startswith(b"data: ")
        )
        payload = _json_object(data)
        if payload and payload.get("type") == "complete":
            presentation = payload.get("presentation")
            if isinstance(presentation, dict):
                presentations.append(presentation)
    return presentations


async def maybe_proxy_presenton_cloud_request(
    request: Request,
    session: AsyncSession,
    user: User | None,
) -> Response | None:
    if user is None or not should_proxy_presenton_cloud(request.url.path):
        return None

    settings = await get_provider_settings(session)
    if settings.get("LLM") != "presenton":
        return None

    issuer = get_presenton_oauth_issuer()
    provider = await get_presenton_provider(session, issuer)
    if not has_cloud_credentials(provider):
        return JSONResponse(
            status_code=503,
            content={
                "detail": "Presenton is selected but the global provider is not connected"
            },
        )
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

    is_success = 200 <= upstream.status_code < 300
    if request.url.path == "/api/v1/ppt/presentation/create":
        try:
            response_body = await upstream.aread()
            if is_success:
                request_payload = _json_object(await request.body())
                cloud_payload = _json_object(response_body)
                if request_payload is not None and cloud_payload is not None:
                    await persist_cloud_presentation_created(
                        user.id,
                        request_payload,
                        cloud_payload,
                    )
            return Response(
                content=response_body,
                status_code=upstream.status_code,
                headers=_forward_response_headers(upstream.headers),
            )
        finally:
            await upstream.aclose()
            await client.aclose()

    sse_buffer = bytearray()

    async def stream_body() -> AsyncIterator[bytes]:
        try:
            async for chunk in upstream.aiter_raw():
                if (
                    is_success
                    and request.url.path.startswith(
                        "/api/v1/ppt/presentation/stream/"
                    )
                ):
                    sse_buffer.extend(chunk)
                    for presentation in _complete_presentations_from_sse(sse_buffer):
                        await persist_cloud_presentation_complete(
                            user.id,
                            presentation,
                        )
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(
        stream_body(),
        status_code=upstream.status_code,
        headers=_forward_response_headers(upstream.headers),
    )
