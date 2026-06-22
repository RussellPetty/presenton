"""Shared engine for re-skinning a deck to the signed-in user's brand.

Used by both the HTTP endpoint (POST /api/v1/ppt/presentation/apply-branding,
for the external MCP agent) and the in-editor chat assistant tool
(ChatTools.applyUserBranding) so both produce the SAME result: a "Brand" theme
built from the user's colors (full palette generated from primary/secondary/
background), font, logo and company name, saved to the user's theme library and
set as the deck's theme.

`build_brand_theme` is pure (no DB). `apply_brand_theme` persists: it upserts the
"Brand" theme into the user's per-user theme store (the same key the iframe theme
picker reads via GET /themes/all) and sets presentation.theme.
"""

from __future__ import annotations

import copy
from typing import Any, Optional

from sqlmodel import select

from models.sql.key_value import KeyValueSqlModel
from models.sql.presentation import PresentationModel
from utils.asset_directory_utils import normalize_slide_asset_url
from utils.theme_utils import build_theme_data_from_palette, generate_color_palette

BRAND_THEME_ID = "brand"
BRAND_THEME_NAME = "Brand"
# Must always be a complete {name, url}: a missing font silently voids the whole
# theme on export (the headless renderer skips themes without a font).
_DEFAULT_BRAND_FONT = {
    "name": "Inter",
    "url": "https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap",
}

# Per-user theme store key — mirrors api.v1.ppt.endpoints.theme._themes_storage_key
# (kept in sync deliberately; inlined to keep this low-level helper free of any
# api.* import). NOT the chat layer's global key.
_THEMES_STORAGE_KEY = "presentation_custom_themes"


def _themes_storage_key(user_id: str) -> str:
    return f"{_THEMES_STORAGE_KEY}::{user_id}"


def _clean(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text or None


def _pick(branding: dict[str, Any], *keys: str) -> Optional[str]:
    """First non-empty value among the given keys (camelCase or snake_case)."""
    for key in keys:
        cleaned = _clean(branding.get(key))
        if cleaned:
            return cleaned
    return None


def _font_for_branding(*names: Any) -> Optional[dict[str, str]]:
    """First non-empty font name -> a Google Fonts CSS2 entry; else None.

    name + url are always non-empty strings so the export renderer never drops
    the theme. A non-Google family just falls back to the system font at render.
    """
    for name in names:
        cleaned = _clean(name)
        if cleaned:
            family = "+".join(cleaned.split())
            return {
                "name": cleaned,
                "url": (
                    f"https://fonts.googleapis.com/css2?family={family}"
                    ":wght@400;500;600;700&display=swap"
                ),
            }
    return None


def build_brand_theme(
    branding: Optional[dict[str, Any]], user_id: str
) -> Optional[dict[str, Any]]:
    """Build a complete "Brand" theme dict from a branding profile.

    Accepts camelCase (primaryColor/logoUrl/...) or snake_case keys — both the
    HTTP payload and the broker-posted chat branding use camelCase. Returns None
    when there's nothing to apply (no color, logo, or company name).
    """
    if not isinstance(branding, dict) or not branding:
        return None

    primary = _pick(branding, "primaryColor", "primary_color", "primary")
    background = _pick(branding, "backgroundColor", "background_color", "background")
    secondary = _pick(branding, "secondaryColor", "secondary_color")
    logo_url_raw = _pick(branding, "logoUrl", "logo_url", "logo")
    company_name = _pick(branding, "companyName", "company", "name")
    font_heading = _pick(branding, "fontHeading", "font_heading")
    font_body = _pick(branding, "fontBody", "font_body")

    if not (primary or background or logo_url_raw or company_name):
        return None

    palette = generate_color_palette(
        provided_primary=primary,
        provided_background=background,
        provided_accent_1=secondary,
    )
    colors = build_theme_data_from_palette(palette).model_dump()
    text_font = _font_for_branding(font_heading, font_body) or dict(_DEFAULT_BRAND_FONT)
    logo_url = normalize_slide_asset_url(logo_url_raw) if logo_url_raw else None

    return {
        "id": BRAND_THEME_ID,
        "name": BRAND_THEME_NAME,
        "description": "Auto-applied from your brand settings",
        "user": user_id,
        "logo": None,
        "logo_url": logo_url,
        "company_name": company_name,
        "data": {"colors": colors, "fonts": {"textFont": text_font}},
    }


async def apply_brand_theme(
    *,
    sql_session: Any,
    user_id: str,
    presentation: PresentationModel,
    branding: Optional[dict[str, Any]],
) -> Optional[dict[str, Any]]:
    """Build + persist the "Brand" theme for a presentation. Returns the theme,
    or None if there was no usable branding (caller surfaces a friendly message).

    Idempotent: re-running updates the same "Brand" entry in the user's theme
    library (keyed by id/name) so the deck keeps pointing at one theme.
    """
    theme = build_brand_theme(branding, user_id)
    if theme is None:
        return None

    storage_key = _themes_storage_key(user_id)
    row = await sql_session.scalar(
        select(KeyValueSqlModel).where(KeyValueSqlModel.key == storage_key)
    )
    existing_value = row.value if (row and isinstance(row.value, dict)) else {}
    themes = existing_value.get("themes")
    themes = copy.deepcopy(themes) if isinstance(themes, list) else []

    for index, existing in enumerate(themes):
        if not isinstance(existing, dict):
            continue
        if str(existing.get("id")) == BRAND_THEME_ID or existing.get("name") == BRAND_THEME_NAME:
            # Keep the existing id so the deck keeps pointing at the same theme.
            theme["id"] = str(existing.get("id") or BRAND_THEME_ID)
            themes[index] = theme
            break
    else:
        themes.append(theme)

    if row:
        row.value = {"themes": themes}
        sql_session.add(row)
    else:
        sql_session.add(KeyValueSqlModel(key=storage_key, value={"themes": themes}))

    presentation.theme = copy.deepcopy(theme)
    sql_session.add(presentation)
    await sql_session.commit()

    return theme
