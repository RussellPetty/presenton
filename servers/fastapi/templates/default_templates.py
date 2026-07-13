from __future__ import annotations

import json
import logging
import shutil
from pathlib import Path, PurePosixPath
from typing import Any

from models.sql.template_v2 import TemplateV2
from services.database import async_session_maker
from templates.v2.models.layouts import MergedComponents, RawSlideLayouts, SlideLayouts
from utils.get_env import get_app_data_directory_env
from utils.icon_weights import extract_icon_type_from_settings


LOGGER = logging.getLogger(__name__)


async def import_default_templates_on_startup(
    templates_root: Path | None = None,
) -> None:
    root = templates_root or _default_templates_root()
    if not root.is_dir():
        LOGGER.info("Default templates directory not found: %s", root)
        return

    template_dirs = [
        path
        for path in sorted(root.iterdir())
        if path.is_dir() and (path / "template.json").is_file()
    ]
    if not template_dirs:
        LOGGER.info("No default templates found in: %s", root)
        return

    async with async_session_maker() as session:
        for template_dir in template_dirs:
            template = _load_default_template(template_dir)
            existing = await session.get(TemplateV2, template.id)

            _copy_default_template_static_assets(template_dir, template.id)
            if existing:
                _update_template_from_default(existing, template)
                session.add(existing)
                LOGGER.info("Updated default template: %s", template.id)
            else:
                session.add(template)
                LOGGER.info("Imported default template: %s", template.id)
            await session.commit()


def _default_templates_root() -> Path:
    return Path(__file__).resolve().parents[3] / "templates"


def _load_default_template(template_dir: Path) -> TemplateV2:
    template_json_path = template_dir / "template.json"
    raw = json.loads(template_json_path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"Default template must be a JSON object: {template_json_path}")

    template_id = _read_template_id(raw, template_dir)
    rewritten = _rewrite_static_asset_urls(raw, template_id)

    layouts = _coerce_slide_layouts(rewritten.get("layouts"))
    merged_components = _coerce_merged_components(rewritten.get("merged_components"))
    raw_layouts = _coerce_raw_layouts(rewritten.get("raw_layouts"))
    components = rewritten.get("components")
    assets = _build_assets(rewritten, template_id, layouts, merged_components)

    return TemplateV2(
        id=template_id,
        name=_read_required_string(rewritten, "name", template_id),
        description=_read_optional_string(rewritten.get("description")),
        raw_layouts=raw_layouts,
        components=components if isinstance(components, dict) else None,
        merged_components=merged_components,
        layouts=layouts,
        assets=assets,
        is_default=True,
    )


def _update_template_from_default(existing: TemplateV2, template: TemplateV2) -> None:
    existing.name = template.name
    existing.description = template.description
    existing.raw_layouts = template.raw_layouts
    existing.components = template.components
    existing.merged_components = template.merged_components
    existing.layouts = template.layouts
    existing.assets = template.assets
    existing.is_default = True


def _read_template_id(raw: dict[str, Any], template_dir: Path) -> str:
    template_id = raw.get("id")
    if not isinstance(template_id, str) or not template_id.strip():
        template_id = template_dir.name
    template_id = template_id.strip()
    if "/" in template_id or "\\" in template_id:
        raise ValueError(
            f"Default template id cannot contain path separators: {template_id}"
        )
    return template_id


def _read_required_string(raw: dict[str, Any], key: str, fallback: str) -> str:
    value = raw.get(key)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return fallback


def _read_optional_string(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _coerce_slide_layouts(value: Any) -> dict[str, Any]:
    payload = {"layouts": value} if isinstance(value, list) else value
    return SlideLayouts.model_validate(payload).model_dump(
        mode="json",
        exclude_none=True,
    )


def _coerce_merged_components(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    payload = {"components": value} if isinstance(value, list) else value
    return MergedComponents.model_validate(payload).model_dump(
        mode="json",
        exclude_none=True,
    )


def _coerce_raw_layouts(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    payload = {"layouts": value} if isinstance(value, list) else value
    return RawSlideLayouts.model_validate(payload).model_dump(
        mode="json",
        exclude_none=True,
    )


def _build_assets(
    rewritten_template_json: dict[str, Any],
    template_id: str,
    layouts: dict[str, Any],
    merged_components: dict[str, Any] | None,
) -> dict[str, Any]:
    icon_type = extract_icon_type_from_settings(rewritten_template_json)
    assets: dict[str, Any] = {
        "template_id": template_id,
        "icon_type": icon_type,
        "icon_weight": icon_type,
        "fonts": rewritten_template_json.get("fonts")
        if isinstance(rewritten_template_json.get("fonts"), dict)
        else {},
        "images": _collect_image_urls(layouts, merged_components),
    }

    thumbnail = rewritten_template_json.get("thumbnail")
    if isinstance(thumbnail, str) and thumbnail.strip():
        assets["thumbnail"] = thumbnail.strip()

    return assets


def _rewrite_static_asset_urls(value: Any, template_id: str) -> Any:
    if isinstance(value, str):
        return _rewrite_static_asset_url(value, template_id)
    if isinstance(value, list):
        return [_rewrite_static_asset_urls(item, template_id) for item in value]
    if isinstance(value, dict):
        return {
            key: _rewrite_static_asset_urls(child, template_id)
            for key, child in value.items()
        }
    return value


def _rewrite_static_asset_url(value: str, template_id: str) -> str:
    if not value.startswith("static/"):
        return value

    relative = PurePosixPath(value)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError(f"Invalid default template static asset path: {value}")
    return f"/app_data/templates/{template_id}/{relative.as_posix()}"


def _collect_image_urls(*values: Any) -> list[str]:
    images: list[str] = []
    seen: set[str] = set()

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            if value.get("type") == "image":
                image_data = value.get("data")
                if (
                    isinstance(image_data, str)
                    and image_data
                    and image_data not in seen
                ):
                    seen.add(image_data)
                    images.append(image_data)
            for child in value.values():
                visit(child)
            return

        if isinstance(value, list):
            for item in value:
                visit(item)

    for value in values:
        visit(value)
    return images


def _copy_default_template_static_assets(template_dir: Path, template_id: str) -> None:
    source = template_dir / "static"
    if not source.is_dir():
        return

    app_data_dir = get_app_data_directory_env()
    if not app_data_dir:
        raise RuntimeError("APP_DATA_DIRECTORY must be set to import default templates")

    destination = Path(app_data_dir) / "templates" / template_id / "static"
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, destination, dirs_exist_ok=True)
