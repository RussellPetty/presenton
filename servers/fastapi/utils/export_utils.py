import os
import logging
from typing import Literal
from urllib.parse import urlencode
import uuid

from pathvalidate import sanitize_filename

from models.presentation_and_path import PresentationAndPath
from utils.filename_utils import safe_export_basename
from services.export_task_service import EXPORT_TASK_SERVICE
from utils.get_env import is_supabase_storage_enabled
from utils.runtime_limits import log_memory


LOGGER = logging.getLogger(__name__)


def _get_next_public_url() -> str:
    return (os.getenv("NEXT_PUBLIC_URL") or "").strip() or "http://127.0.0.1"


def _get_next_public_fastapi_url() -> str | None:
    value = (os.getenv("NEXT_PUBLIC_FAST_API") or "").strip()
    return value or None


def _build_presentation_export_url(presentation_id: uuid.UUID) -> tuple[str, str | None]:
    params = {"id": str(presentation_id)}
    fastapi_url = _get_next_public_fastapi_url()
    if fastapi_url:
        params["fastapiUrl"] = fastapi_url
    return (
        f"{_get_next_public_url().rstrip('/')}/pdf-maker?{urlencode(params)}",
        fastapi_url,
    )


async def export_presentation(
    presentation_id: uuid.UUID,
    title: str,
    export_as: Literal["pptx", "pdf"],
    cookie_header: str | None = None,
    user_id: str | None = None,
) -> PresentationAndPath:
    log_memory(
        LOGGER,
        "presentation.export.start",
        presentation_id=str(presentation_id),
        export_as=export_as,
    )
    export_url, fastapi_url = _build_presentation_export_url(presentation_id)
    name = (title or "").strip() or str(uuid.uuid4())
    export_result = await EXPORT_TASK_SERVICE.export_from_url(
        url=export_url,
        title=safe_export_basename(sanitize_filename(name)),
        export_as=export_as,
        fastapi_url=fastapi_url,
        cookie_header=cookie_header,
    )
    log_memory(
        LOGGER,
        "presentation.export.finish",
        presentation_id=str(presentation_id),
        export_as=export_as,
    )
    path = export_result.path
    # Durable exports: when Supabase Storage is enabled, upload the rendered file
    # to the private bucket and hand back a signed download URL (one-shot download
    # link, so expiry isn't an issue), then drop the local temp copy so the
    # container stays stateless. Local mode is unchanged.
    if is_supabase_storage_enabled() and user_id:
        from services import object_storage

        content_type = (
            "application/pdf"
            if export_as == "pdf"
            else "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        )
        key = object_storage.build_key(user_id, "exports", os.path.basename(path))
        await object_storage.upload_file(key, path, content_type)
        path = await object_storage.create_signed_url(key, expires_in=30 * 24 * 3600)
        try:
            os.remove(export_result.path)
        except OSError:
            pass

    return PresentationAndPath(
        presentation_id=presentation_id,
        path=path,
    )
