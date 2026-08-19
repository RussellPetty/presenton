import os
import logging
from typing import Literal
from urllib.parse import urlencode
import uuid

from pathvalidate import sanitize_filename

from api.v1.auth.context import get_current_owner_id
from models.presentation_and_path import PresentationAndPath
from utils.filename_utils import safe_export_basename
from services.export_task_service import EXPORT_TASK_SERVICE
from utils.get_env import is_supabase_storage_enabled
from utils.runtime_limits import log_memory


LOGGER = logging.getLogger(__name__)

# Signed export links are handed to the browser for a one-shot download, so a
# long TTL costs nothing and survives a user coming back to an older deck.
EXPORT_SIGNED_URL_TTL_SECONDS = 30 * 24 * 3600


def _get_next_public_url() -> str:
    return (os.getenv("NEXT_PUBLIC_URL") or "").strip() or "http://127.0.0.1"


def _get_next_public_fastapi_url() -> str | None:
    value = (os.getenv("NEXT_PUBLIC_FAST_API") or "").strip()
    return value or None


def _build_presentation_export_url(
    presentation_id: uuid.UUID, cookie_header: str | None = None
) -> tuple[str, str | None]:
    params = {"id": str(presentation_id)}
    fastapi_url = _get_next_public_fastapi_url()
    if fastapi_url:
        params["fastapiUrl"] = fastapi_url
    export_url = f"{_get_next_public_url().rstrip('/')}/pdf-maker?{urlencode(params)}"
    if cookie_header:
        export_url = f"{export_url}#{urlencode({'exportCookie': cookie_header})}"
    return (
        export_url,
        fastapi_url,
    )


async def export_presentation(
    presentation_id: uuid.UUID,
    title: str,
    export_as: Literal["pptx", "pdf"],
    cookie_header: str | None = None,
) -> PresentationAndPath:
    log_memory(
        LOGGER,
        "presentation.export.start",
        presentation_id=str(presentation_id),
        export_as=export_as,
    )
    export_url, fastapi_url = _build_presentation_export_url(
        presentation_id, cookie_header
    )
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

    # Durable exports: Railway containers have ephemeral disk, so when Supabase
    # Storage is enabled we upload the rendered file to the private bucket and
    # hand back a signed download URL, then drop the local copy so the container
    # stays stateless. Objects are keyed by owner, and the owner comes from the
    # request-scoped ContextVar that already scopes every query. Local mode is
    # unchanged.
    owner_id = get_current_owner_id()
    if is_supabase_storage_enabled() and owner_id:
        from services import object_storage

        content_type = (
            "application/pdf"
            if export_as == "pdf"
            else "application/vnd.openxmlformats-officedocument"
            ".presentationml.presentation"
        )
        key = object_storage.build_key(
            str(owner_id), "exports", os.path.basename(path)
        )
        await object_storage.upload_file(key, path, content_type)
        path = await object_storage.create_signed_url(
            key, expires_in=EXPORT_SIGNED_URL_TTL_SECONDS
        )
        try:
            os.remove(export_result.path)
        except OSError:
            LOGGER.warning(
                "Could not remove local export after upload: %s", export_result.path
            )

    return PresentationAndPath(
        presentation_id=presentation_id,
        path=path,
    )
