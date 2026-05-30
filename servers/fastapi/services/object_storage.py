"""Supabase Storage backend (gated by STORAGE_BACKEND=supabase).

Uses the Storage REST API with the project's service-role key (reusing the
broker-marketplace Supabase creds) — no separate S3 keys. Objects are keyed per
user: ``{user_id}/{category}/{filename}`` in a private bucket; the browser/export
runtime fetch them via short-lived signed URLs minted on demand (ownership is
enforced by the API layer before signing).

When STORAGE_BACKEND is not 'supabase' these helpers are unused and the app keeps
writing to the local filesystem under APP_DATA_DIRECTORY (unchanged).
"""

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
    return f"{url}/storage/v1{signed}"


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


async def delete(key: str) -> None:
    url, skey, bucket = _config()
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.delete(
            f"{url}/storage/v1/object/{bucket}/{key}", headers=_headers(skey)
        )
        if resp.status_code not in (200, 204, 404):
            resp.raise_for_status()


__all__ = [
    "is_supabase_storage_enabled",
    "build_key",
    "upload_bytes",
    "upload_file",
    "create_signed_url",
    "download_to_path",
    "delete",
    "StorageConfigError",
]
