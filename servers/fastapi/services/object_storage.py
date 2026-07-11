"""Supabase Storage backend (gated by STORAGE_BACKEND=supabase).

Uses the Storage REST API with the project's service-role key (reusing the
broker-marketplace Supabase creds) — no separate S3 keys. Objects are keyed per
user: ``{user_id}/{category}/{filename}`` in a private bucket; the browser/export
runtime fetch them via short-lived signed URLs minted on demand (ownership is
enforced by the API layer before signing).

When STORAGE_BACKEND is not 'supabase' these helpers are unused and the app keeps
writing to the local filesystem under APP_DATA_DIRECTORY (unchanged).
"""

import mimetypes
import os
import uuid

import httpx

from utils.get_env import (
    get_supabase_service_role_key_env,
    get_supabase_storage_bucket_env,
    get_supabase_url_env,
    is_supabase_storage_enabled,
)


class StorageConfigError(RuntimeError):
    pass


def _config() -> tuple[str, str, str]:
    url = get_supabase_url_env()
    key = get_supabase_service_role_key_env()
    if not url or not key:
        raise StorageConfigError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when STORAGE_BACKEND=supabase"
        )
    return url, key, get_supabase_storage_bucket_env()


def _headers(key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {key}", "apikey": key}


def build_key(user_id: str, category: str, filename: str | None = None, ext: str = "") -> str:
    """Per-user object key: ``{user_id}/{category}/{filename or uuid+ext}``."""
    safe_user = (user_id or "local").strip("/") or "local"
    name = filename or f"{uuid.uuid4()}{ext}"
    return f"{safe_user}/{category}/{name}"


async def upload_bytes(
    key: str, data: bytes, content_type: str = "application/octet-stream"
) -> str:
    """Upsert raw bytes at ``key``; returns the key."""
    url, skey, bucket = _config()
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            f"{url}/storage/v1/object/{bucket}/{key}",
            content=data,
            headers={**_headers(skey), "Content-Type": content_type, "x-upsert": "true"},
        )
        resp.raise_for_status()
    return key


async def upload_file(key: str, path: str, content_type: str = "application/octet-stream") -> str:
    with open(path, "rb") as f:
        return await upload_bytes(key, f.read(), content_type)


async def create_signed_url(key: str, expires_in: int = 3600) -> str:
    """Return a time-limited signed URL for a private object."""
    url, skey, bucket = _config()
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{url}/storage/v1/object/sign/{bucket}/{key}",
            json={"expiresIn": expires_in},
            headers={**_headers(skey), "Content-Type": "application/json"},
        )
        resp.raise_for_status()
        signed = resp.json().get("signedURL") or resp.json().get("signedUrl")
    if not signed:
        raise StorageConfigError(f"No signedURL returned for {key}")
    # Supabase may return object paths containing literal spaces. Serialize via
    # httpx.URL so future slide data stores the same %20 form browsers expose
    # through HTMLImageElement.src. Existing escapes and the signed query token
    # are preserved.
    return str(httpx.URL(f"{url}/storage/v1{signed}"))


async def download_to_path(key: str, dest_path: str) -> str:
    """Download an object to a local path (e.g. fonts needed by the renderer)."""
    url, skey, bucket = _config()
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.get(
            f"{url}/storage/v1/object/{bucket}/{key}", headers=_headers(skey)
        )
        resp.raise_for_status()
        with open(dest_path, "wb") as f:
            f.write(resp.content)
    return dest_path


# Long TTL for image URLs embedded in slide content (decks are viewed/edited over
# time, and the headless export renderer fetches them). Non-sensitive deck imagery.
IMAGE_SIGNED_URL_TTL = 31_536_000  # ~1 year


async def offload_local_image(local_path: str, user_id: str) -> str:
    """Upload a locally-rendered image to the private bucket and return a
    long-lived signed URL, deleting the local temp copy (stateless). Used at
    image-generation/upload time so slide content + assets reference Storage."""
    ext = os.path.splitext(local_path)[1] or ".png"
    filename = os.path.basename(local_path) or f"{uuid.uuid4()}{ext}"
    key = build_key(user_id, "images", filename)
    content_type = mimetypes.guess_type(local_path)[0] or "image/png"
    await upload_file(key, local_path, content_type)
    url = await create_signed_url(key, expires_in=IMAGE_SIGNED_URL_TTL)
    try:
        os.remove(local_path)
    except OSError:
        pass
    return url


async def delete(key: str) -> None:
    url, skey, bucket = _config()
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.delete(
            f"{url}/storage/v1/object/{bucket}/{key}", headers=_headers(skey)
        )
        if resp.status_code not in (200, 204, 404):
            resp.raise_for_status()


async def list_keys(prefix: str) -> list[str]:
    """List object keys under a folder `prefix` (e.g. "fonts")."""
    url, skey, bucket = _config()
    folder = prefix.strip("/")
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{url}/storage/v1/object/list/{bucket}",
            json={"prefix": folder, "limit": 1000},
            headers={**_headers(skey), "Content-Type": "application/json"},
        )
        resp.raise_for_status()
        items = resp.json() or []
    keys: list[str] = []
    for it in items:
        name = it.get("name")
        if name and it.get("id") and not name.endswith("/"):
            keys.append(f"{folder}/{name}")
    return keys


async def sync_prefix_to_dir(prefix: str, local_dir: str) -> int:
    """Download every object under `prefix` into `local_dir` (skipping files that
    already exist locally). Used at startup to repopulate fonts on a fresh
    (stateless) container. Returns the number of files downloaded."""
    os.makedirs(local_dir, exist_ok=True)
    count = 0
    for key in await list_keys(prefix):
        dest = os.path.join(local_dir, os.path.basename(key))
        if os.path.exists(dest):
            continue
        try:
            await download_to_path(key, dest)
            count += 1
        except Exception:
            pass
    return count


__all__ = [
    "is_supabase_storage_enabled",
    "build_key",
    "upload_bytes",
    "upload_file",
    "offload_local_image",
    "create_signed_url",
    "download_to_path",
    "list_keys",
    "sync_prefix_to_dir",
    "delete",
    "StorageConfigError",
]
