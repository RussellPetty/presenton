import logging
from io import BytesIO
from typing import List
from fastapi import APIRouter, Depends, File, UploadFile, HTTPException, Query, Header
from PIL import Image, UnidentifiedImageError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from models.image_prompt import ImagePrompt
from models.sql.image_asset import ImageAsset
from services.database import get_async_session
from services.image_generation_service import ImageGenerationService
from utils.asset_directory_utils import (
    filesystem_image_path_to_app_data_url,
    get_images_directory,
    normalize_slide_asset_url,
)
from utils.get_env import get_pexels_api_key_env, get_pixabay_api_key_env
from utils.image_provider import get_selected_image_provider
from enums.image_provider import ImageProvider
import os
import uuid
from utils.file_utils import get_file_name_with_random_uuid
from api.v1.auth.context import get_current_owner_id
from utils.get_env import is_supabase_storage_enabled

IMAGES_ROUTER = APIRouter(prefix="/images", tags=["Images"])

ALLOWED_UPLOAD_IMAGE_EXTENSIONS = {
    ".avif",
    ".bmp",
    ".gif",
    ".jpeg",
    ".jpg",
    ".png",
    ".tif",
    ".tiff",
    ".webp",
}
ALLOWED_UPLOAD_IMAGE_FORMATS = {
    "AVIF",
    "BMP",
    "GIF",
    "JPEG",
    "PNG",
    "TIFF",
    "WEBP",
}
REDACTED_SECRET_PLACEHOLDER = "__configured__"


async def _read_validated_image_upload(file: UploadFile) -> bytes:
    filename = file.filename or ""
    extension = os.path.splitext(filename)[1].lower()
    if extension not in ALLOWED_UPLOAD_IMAGE_EXTENSIONS:
        accepted = ", ".join(sorted(ALLOWED_UPLOAD_IMAGE_EXTENSIONS))
        raise HTTPException(
            status_code=400,
            detail=f"Invalid image file type. Accepted types: {accepted}",
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded image file is empty")

    try:
        with Image.open(BytesIO(content)) as image:
            if image.format not in ALLOWED_UPLOAD_IMAGE_FORMATS:
                raise HTTPException(
                    status_code=400,
                    detail="Uploaded image format is not supported",
                )
            image.verify()
    except HTTPException:
        raise
    except (
        Image.DecompressionBombError,
        OSError,
        SyntaxError,
        UnidentifiedImageError,
        ValueError,
    ):
        raise HTTPException(
            status_code=400, detail="Uploaded file is not a valid image"
        )

    return content


def _normalize_stock_provider(provider: str | None) -> str:
    normalized_provider = (provider or "").strip().lower()
    if normalized_provider in {"pixels", "pixel", "pexel"}:
        normalized_provider = "pexels"

    if normalized_provider:
        if normalized_provider in {"pexels", "pixabay"}:
            return normalized_provider
        raise HTTPException(
            status_code=400,
            detail="provider must be either 'pexels' or 'pixabay'",
        )

    selected_provider = get_selected_image_provider()
    if selected_provider == ImageProvider.PIXABAY:
        return "pixabay"
    return "pexels"


def _resolve_stock_api_key(
    request_api_key: str | None, configured_api_key: str | None
) -> str:
    normalized_request_key = (request_api_key or "").strip()
    if normalized_request_key == REDACTED_SECRET_PLACEHOLDER:
        normalized_request_key = ""
    return (normalized_request_key or configured_api_key or "").strip()


@IMAGES_ROUTER.get("/search", response_model=List[str])
async def search_stock_images(
    query: str,
    limit: int = Query(default=12, ge=1, le=30),
    provider: str | None = Query(default=None),
    strict_api_key: bool = Query(default=False),
    x_provider_api_key: str | None = Header(default=None, alias="X-Provider-Api-Key"),
):
    normalized_provider = _normalize_stock_provider(provider)

    image_generation_service = ImageGenerationService(get_images_directory())

    if normalized_provider == "pexels":
        api_key = _resolve_stock_api_key(x_provider_api_key, get_pexels_api_key_env())
        if strict_api_key and not api_key:
            raise HTTPException(status_code=401, detail="Pexels API key is required")

        # Pexels can return cached public responses for common queries.
        # Use a nonce query in strict mode to force a real auth check.
        if strict_api_key:
            validation_query = f"__presenton_auth_check_{uuid.uuid4().hex}"
            await image_generation_service.get_image_from_pexels(
                validation_query,
                api_key=api_key,
                limit=1,
            )

        images = await image_generation_service.get_image_from_pexels(
            query,
            api_key=api_key,
            limit=limit,
        )
        if isinstance(images, str):
            return [images] if images else []
        return images

    api_key = _resolve_stock_api_key(x_provider_api_key, get_pixabay_api_key_env())
    if strict_api_key and not api_key:
        raise HTTPException(status_code=401, detail="Pixabay API key is required")

    images = await image_generation_service.get_image_from_pixabay(
        query,
        api_key=api_key,
        limit=limit,
    )
    if isinstance(images, str):
        return [images] if images else []
    return images


@IMAGES_ROUTER.get("/generate")
async def generate_image(
    prompt: str, sql_session: AsyncSession = Depends(get_async_session)
):
    images_directory = get_images_directory()
    image_prompt = ImagePrompt(prompt=prompt)
    image_generation_service = ImageGenerationService(images_directory)

    image = await image_generation_service.generate_image(image_prompt)
    if not isinstance(image, ImageAsset):
        return normalize_slide_asset_url(image) if isinstance(image, str) else image

    # Railway containers have ephemeral disk, so a generated image written to
    # local storage disappears on the next deploy and every deck referencing it
    # renders a broken slot. Offload to the bucket and keep the remote URL.
    image.path = await offload_image_when_remote(image.path)

    sql_session.add(image)
    await sql_session.commit()

    return filesystem_image_path_to_app_data_url(image.path)


async def offload_image_when_remote(path: str) -> str:
    """Move a locally written image into object storage when it is enabled.

    Returns the storage URL, or the original path unchanged in local mode. The
    object is keyed by the request's owner, taken from the same ContextVar that
    scopes every query, so one tenant's uploads never land under another's
    prefix.
    """
    if not is_supabase_storage_enabled():
        return path

    owner_id = get_current_owner_id()
    if not owner_id:
        return path

    from services.object_storage import offload_local_image

    try:
        return await offload_local_image(path, str(owner_id))
    except Exception:
        # A storage blip should not lose the image the user just made: keep the
        # local copy and let the next deploy be the thing that notices.
        logging.getLogger(__name__).exception(
            "Image offload failed; keeping local path %s", path
        )
        return path


def _image_asset_api_dict(asset: ImageAsset) -> dict:
    return {
        "id": asset.id,
        "created_at": asset.created_at,
        "is_uploaded": asset.is_uploaded,
        "path": asset.path,
        "extras": asset.extras,
        "file_url": filesystem_image_path_to_app_data_url(asset.path),
    }


@IMAGES_ROUTER.get("/generated")
async def get_generated_images(sql_session: AsyncSession = Depends(get_async_session)):
    try:
        images_result = await sql_session.scalars(
            select(ImageAsset)
            .where(ImageAsset.is_uploaded == False)
            .order_by(ImageAsset.created_at.desc())
        )
        return [_image_asset_api_dict(a) for a in images_result]
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to retrieve generated images: {str(e)}"
        )


@IMAGES_ROUTER.post("/upload")
async def upload_image(
    file: UploadFile = File(...), sql_session: AsyncSession = Depends(get_async_session)
):
    try:
        content = await _read_validated_image_upload(file)
        new_filename = get_file_name_with_random_uuid(file)
        image_path = os.path.join(
            get_images_directory(), os.path.basename(new_filename)
        )

        with open(image_path, "wb") as f:
            f.write(content)

        image_path = await offload_image_when_remote(image_path)
        image_asset = ImageAsset(path=image_path, is_uploaded=True)

        sql_session.add(image_asset)
        await sql_session.commit()
        # Refresh to ensure all defaults are loaded
        await sql_session.refresh(image_asset)

        return _image_asset_api_dict(image_asset)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload image: {str(e)}")


@IMAGES_ROUTER.get("/uploaded")
async def get_uploaded_images(sql_session: AsyncSession = Depends(get_async_session)):
    try:
        images_result = await sql_session.scalars(
            select(ImageAsset)
            .where(ImageAsset.is_uploaded == True)
            .order_by(ImageAsset.created_at.desc())
        )
        return [_image_asset_api_dict(a) for a in images_result]
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to retrieve uploaded images: {str(e)}"
        )


@IMAGES_ROUTER.delete("/{id}", status_code=204)
async def delete_uploaded_image_by_id(
    id: uuid.UUID, sql_session: AsyncSession = Depends(get_async_session)
):
    try:
        # Fetch the asset to get its actual file path
        image = await sql_session.get(ImageAsset, id)
        if not image:
            raise HTTPException(status_code=404, detail="Image not found")

        os.remove(image.path)

        await sql_session.delete(image)
        await sql_session.commit()

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete image: {str(e)}")
