"""Brand-asset helpers for the chat tools and slide saving.

`sanitize_brand` reduces a raw branding/partner record (broker user branding or a
connected-realtor record) to a clean, model-safe subset (URLs only — no base64,
empties dropped).

`apply_brand_assets_to_content` enforces, server-side, that a user's (or a named
connected realtor's) REAL logo/headshot is used on a slide instead of an
AI-generated/stock image. The model reliably ignores prompt instructions here: it
fills `__image_prompt__` and lets the image processor generate a stock photo
(`utils/process_slides.process_slide_and_fetch_assets` always generates from
`__image_prompt__` and overwrites `__image_url__`). So after schema validation we
pin the real `__image_url__` and DROP `__image_prompt__` for brand slots — which
makes the processor skip that slot and keep the real image.
"""

from __future__ import annotations

from typing import Any, Iterator

# Whitelist of branding keys → output key, mapping several incoming field-name
# variants. Image data is exposed only as URLs (never base64).
BRAND_FIELD_MAP: dict[str, tuple[str, ...]] = {
    "name": ("fullName", "name", "full_name"),
    "company_name": ("companyName", "company", "company_name"),
    "title": ("title",),
    "email": ("email",),
    "phone": ("phone",),
    "nmls": ("nmls",),
    "company_nmls": ("companyNmls", "company_nmls"),
    "license": ("license",),
    "disclaimer": ("disclaimer",),
    "logo_url": ("logoUrl", "logo_url", "logo"),
    "headshot_url": ("headshotUrl", "headshot_url", "headshot"),
    "meeting_link": ("meetingLink", "meeting_link"),
    "website": ("website",),
    "primary_color": ("primaryColor", "primary_color"),
    "secondary_color": ("secondaryColor", "secondary_color"),
    "type": ("type", "role"),
}

_LOGO_KEYWORDS = ("logo", "wordmark", "brand mark")
_HEADSHOT_KEYWORDS = (
    "headshot",
    "head shot",
    "portrait",
    "profile photo",
    "profile picture",
    "profile pic",
)


def sanitize_brand(raw: Any) -> dict[str, Any] | None:
    """Reduce a raw branding/partner record to clean, model-safe fields."""
    if not isinstance(raw, dict):
        return None

    def clean_str(value: Any, limit: int = 2000) -> str | None:
        if not isinstance(value, str):
            return None
        text = value.strip()
        if not text or len(text) > limit:
            return None  # drop empties + oversized values (e.g. inlined base64)
        return text

    profile: dict[str, Any] = {}
    for out_key, in_keys in BRAND_FIELD_MAP.items():
        for in_key in in_keys:
            if in_key in raw:
                cleaned = clean_str(raw.get(in_key))
                if cleaned:
                    profile[out_key] = cleaned
                    break

    social_raw = raw.get("socialLinks") or raw.get("social_links")
    if isinstance(social_raw, dict):
        socials = {
            key: clean_str(value)
            for key, value in social_raw.items()
            if isinstance(key, str)
        }
        socials = {k: v for k, v in socials.items() if v}
        if socials:
            profile["social_links"] = socials

    return profile or None


def build_profiles(
    branding: dict[str, Any] | None,
    partners: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Sanitized profiles, user first then partners."""
    profiles: list[dict[str, Any]] = []
    user = sanitize_brand(branding)
    if user:
        profiles.append(user)
    for partner in partners or []:
        sanitized = sanitize_brand(partner)
        if sanitized:
            profiles.append(sanitized)
    return profiles


def _iter_image_slots(node: Any) -> Iterator[dict[str, Any]]:
    """Yield every dict in the content tree that is an image slot."""
    if isinstance(node, dict):
        if "__image_prompt__" in node or "__image_url__" in node:
            yield node
        for value in node.values():
            yield from _iter_image_slots(value)
    elif isinstance(node, list):
        for item in node:
            yield from _iter_image_slots(item)


def _known_asset_urls(
    profiles: list[dict[str, Any]],
    uploaded_images: list[dict[str, Any]] | None,
) -> set[str]:
    urls: set[str] = set()
    for profile in profiles:
        for key in ("logo_url", "headshot_url"):
            value = profile.get(key)
            if isinstance(value, str) and value.strip():
                urls.add(value.strip())
    for image in uploaded_images or []:
        if isinstance(image, dict):
            value = image.get("url") or image.get("file_url")
            if isinstance(value, str) and value.strip():
                urls.add(value.strip())
    return urls


def _match_profile(
    prompt_lower: str, profiles: list[dict[str, Any]]
) -> dict[str, Any] | None:
    """Return the profile whose name or company is named in the prompt, else None.

    Requiring an explicit name/company match avoids hijacking decorative images
    (e.g. 'portrait of a happy family' must NOT become the user's headshot).
    """
    for profile in profiles:
        tokens: list[str] = []
        name = profile.get("name")
        if isinstance(name, str):
            tokens.extend(token for token in name.lower().split() if len(token) >= 3)
        company = profile.get("company_name")
        if isinstance(company, str):
            company_lower = company.lower().strip()
            if len(company_lower) >= 3:
                tokens.append(company_lower)
        for token in tokens:
            if token in prompt_lower:
                return profile
    return None


def apply_brand_assets_to_content(
    content: Any,
    branding: dict[str, Any] | None,
    partners: list[dict[str, Any]] | None,
    uploaded_images: list[dict[str, Any]] | None = None,
) -> int:
    """Pin real brand/uploaded images into the slide content. Returns slots changed.

    For each image slot: (1) if `__image_url__` is already a known real asset URL
    (the user's/a partner's logo/headshot, or an uploaded image), keep it; (2) else
    if `__image_prompt__` asks for a logo/headshot AND names a known user/partner,
    swap in that real URL. In both cases drop `__image_prompt__` so the image
    processor skips generation and the real image is kept. Decorative images
    (no match) are untouched and generate normally.
    """
    profiles = build_profiles(branding, partners)
    known_urls = _known_asset_urls(profiles, uploaded_images)
    if not profiles and not known_urls:
        return 0

    changed = 0
    for slot in _iter_image_slots(content):
        current_url = slot.get("__image_url__")
        if isinstance(current_url, str) and current_url.strip() in known_urls:
            if slot.pop("__image_prompt__", None) is not None:
                changed += 1
            continue

        prompt_lower = str(slot.get("__image_prompt__") or "").lower()
        if not prompt_lower:
            continue
        is_logo = any(keyword in prompt_lower for keyword in _LOGO_KEYWORDS)
        is_headshot = any(keyword in prompt_lower for keyword in _HEADSHOT_KEYWORDS)
        if not (is_logo or is_headshot):
            continue

        matched = _match_profile(prompt_lower, profiles)
        if not matched:
            continue
        url = matched.get("logo_url") if is_logo else matched.get("headshot_url")
        if isinstance(url, str) and url.strip():
            slot["__image_url__"] = url.strip()
            slot.pop("__image_prompt__", None)
            changed += 1

    return changed
