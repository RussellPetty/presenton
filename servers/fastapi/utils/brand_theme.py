"""Turn a user's saved branding into a deck theme.

The embedding app knows the user's brand (primary/secondary/background colours,
a logo, a company name, fonts) and forwards it per request. This converts that
record into the `custom_theme` payload that
`PresentationChatMemoryLayer.set_presentation_theme` already accepts, so the
whole deck picks up the brand in one step.

Two things are deliberately not hand-rolled here, because upstream already does
them and the old fork's private copies drifted:

* the colour ramp comes from `utils.theme_utils.generate_color_palette`, and
* the theme is persisted and applied by `set_presentation_theme`.

One trap is worth knowing: `data.fonts.textFont` must carry BOTH a name and a
url. If either is missing the theme payload is rejected outright and the deck
silently keeps its old look, so a font name without a resolvable url falls back
to the default rather than producing a half-built theme.
"""

from __future__ import annotations

from typing import Any, Optional

from models.theme_data import GeneratedColorPalette
from templates.font_utils import get_google_font_css_url
from utils.theme_utils import generate_color_palette

BRAND_THEME_NAME = "Brand"
BRAND_THEME_ID = "brand"

_DEFAULT_FONT = {
    "name": "Inter",
    "url": "https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap",
}

# Field-name variants the embedder may send, newest-first.
_PRIMARY_KEYS = ("primaryColor", "primary_color", "primary")
_SECONDARY_KEYS = ("secondaryColor", "secondary_color", "secondary", "accent")
_BACKGROUND_KEYS = ("backgroundColor", "background_color", "background")
_BODY_FONT_KEYS = ("fontBody", "font_body", "bodyFont", "font")
_HEADING_FONT_KEYS = ("fontHeading", "font_heading", "headingFont")
_LOGO_KEYS = ("logoUrl", "logo_url", "logo")
_COMPANY_KEYS = ("companyName", "company_name", "company")


def _first(branding: dict[str, Any], keys: tuple[str, ...]) -> Optional[str]:
    for key in keys:
        value = branding.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _normalize_hex(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    text = value.strip().lower()
    if not text.startswith("#"):
        text = f"#{text}"
    body = text[1:]
    if len(body) == 3:
        body = "".join(char * 2 for char in body)
    if len(body) != 6 or any(char not in "0123456789abcdef" for char in body):
        return None
    return f"#{body}"


def _graph_colors(palette: GeneratedColorPalette) -> dict[str, str]:
    """Ten chart colours derived from the brand, cycling hue before lightness.

    Charts need enough distinct series colours that neighbouring slices stay
    readable, so this alternates between the three brand hues first and only
    then reaches for lighter/darker variations of each.
    """
    bases = [palette.primary, palette.accent_1, palette.accent_2]
    variations = [
        palette.primary_variations,
        palette.accent_1_variations,
        palette.accent_2_variations,
    ]
    ordered: list[str] = list(bases)
    for step in ("600", "300", "700", "200"):
        for variation in variations:
            value = variation.get(step) if isinstance(variation, dict) else None
            if isinstance(value, str) and value not in ordered:
                ordered.append(value)
            if len(ordered) >= 10:
                break
        if len(ordered) >= 10:
            break
    while len(ordered) < 10:
        ordered.append(bases[len(ordered) % len(bases)])
    return {f"graph_{index}": ordered[index] for index in range(10)}


def build_brand_theme_payload(
    branding: dict[str, Any] | None,
) -> Optional[dict[str, Any]]:
    """Build a `custom_theme` payload from a branding record, or None.

    Returns None when the record carries no usable brand colour: applying a
    theme built entirely from defaults would silently overwrite whatever the
    deck already had with something that is not the user's brand.
    """
    if not isinstance(branding, dict):
        return None

    primary = _normalize_hex(_first(branding, _PRIMARY_KEYS))
    secondary = _normalize_hex(_first(branding, _SECONDARY_KEYS))
    background = _normalize_hex(_first(branding, _BACKGROUND_KEYS))
    if not primary and not secondary:
        return None

    palette = generate_color_palette(
        provided_primary=primary,
        provided_background=background,
        provided_accent_1=secondary,
    )

    colors: dict[str, str] = {
        "primary": palette.primary,
        "background": palette.background,
        # `card` is the surface panels sit on: a step off the background rather
        # than the brand colour, or panels become unreadable blocks of brand.
        "card": (palette.background_variations or {}).get("100", palette.background),
        "stroke": (palette.background_variations or {}).get("300", palette.accent_1),
        "primary_text": palette.text_1,
        "background_text": palette.text_1,
    }
    colors.update(_graph_colors(palette))

    font_name = _first(branding, _BODY_FONT_KEYS) or _first(
        branding, _HEADING_FONT_KEYS
    )
    if font_name:
        text_font = {"name": font_name, "url": get_google_font_css_url(font_name)}
    else:
        text_font = dict(_DEFAULT_FONT)

    payload: dict[str, Any] = {
        "id": BRAND_THEME_ID,
        "name": BRAND_THEME_NAME,
        "data": {"colors": colors, "fonts": {"textFont": text_font}},
    }

    logo_url = _first(branding, _LOGO_KEYS)
    if logo_url:
        payload["logo_url"] = logo_url
    company_name = _first(branding, _COMPANY_KEYS)
    if company_name:
        payload["company_name"] = company_name

    return payload
