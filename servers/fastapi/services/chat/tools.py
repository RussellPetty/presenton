import asyncio
import json
import logging
import re
from typing import Any, Awaitable, Callable

import dirtyjson  # type: ignore[import-untyped]
from llmai.shared import AssistantToolCall, Tool  # type: ignore[import-not-found]

from services.chat.schemas import (
    DeleteSlideInput,
    GenerateAssetsInput,
    GenerateIconInput,
    GenerateImageInput,
    GetContentSchemaFromLayoutIdInput,
    GetSlideAtIndexInput,
    NoArgsInput,
    SaveSlideInput,
    SearchSlidesInput,
    SetPresentationThemeInput,
    WebSearchInput,
)
from services.chat.presentation_context_store import PresentationContextStore

LOGGER = logging.getLogger(__name__)

ToolHandler = Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]


class ChatTools:
    def __init__(
        self,
        memory: PresentationContextStore,
        branding: dict[str, Any] | None = None,
        partners: list[dict[str, Any]] | None = None,
    ):
        self._memory = memory
        self._branding = branding or None
        self._partners = partners or None
        self._tool_handlers: dict[str, ToolHandler] = {
            "getPresentationOutline": self._get_presentation_outline,
            "searchSlides": self._search_slides,
            "getSlideAtIndex": self._get_slide_at_index,
            "getPresentationThemeCatalog": self._get_presentation_theme_catalog,
            "getBrandingProfiles": self._get_branding_profiles,
            "webSearch": self._web_search,
            "getAvailableLayouts": self._get_available_layouts,
            "getContentSchemaFromLayoutId": self._get_content_schema_from_layout_id,
            "generateAssets": self._generate_assets,
            "generateImage": self._generate_image,
            "generateIcon": self._generate_icon,
            "saveSlide": self._save_slide,
            "deleteSlide": self._delete_slide,
            "setPresentationTheme": self._set_presentation_theme,
        }

    def get_tool_definitions(self) -> list[Tool]:
        return [
            Tool(
                name="getPresentationOutline",
                description=(
                    "Live database: current deck structure. "
                    "Use for the **actual** slide list/order and compact previews—not for uploaded PDF text or pre-outline RAG. "
                    "Falls back to stored outlines only if no slide rows exist. "
                    "Return compact sections (no full slide JSON). Use for flow, sections, or 'what slides exist'."
                ),
                schema=NoArgsInput,
                strict=True,
            ),
            Tool(
                name="searchSlides",
                description=(
                    "Live SQL slides: keyword/semantic style search with snippets and indices. "
                    "Use to find on-slide text, topics, or which slide mentioned something. "
                    "For source-document-only questions, rely on deck memory; use this when the question is about **slides as built**. "
                    "Always provide both query and limit."
                ),
                schema=SearchSlidesInput,
                strict=True,
            ),
            Tool(
                name="getSlideAtIndex",
                description=(
                    "Live SQL: one slide by index—authoritative for exact current content. "
                    "Set includeFullContent=true when you need full JSON (before saveSlide or precise edits). "
                    "If user says slide N, use zero-based index N-1."
                ),
                schema=GetSlideAtIndexInput,
                strict=True,
            ),
            Tool(
                name="getPresentationThemeCatalog",
                description=(
                    "Read-only theme catalog for the current presentation. "
                    "Returns currently applied color theme and all available color themes "
                    "(built-in + saved custom themes). "
                    "Use this for questions like 'which theme is applied' or "
                    "'what themes are available'. "
                    "Do NOT use getAvailableLayouts for theme questions."
                ),
                schema=NoArgsInput,
                strict=True,
            ),
            Tool(
                name="getBrandingProfiles",
                description=(
                    "Get the user's saved branding plus their connected realtors' branding "
                    "(real values to put ON slides): full name, company, title, email, phone, "
                    "NMLS/company NMLS, license, logo image URL, headshot image URL, disclaimer, "
                    "meeting link, website, social links, and brand colors. "
                    "Call this whenever the user references their own or a partner's brand—e.g. "
                    "'add my logo', 'use my headshot', 'put my contact info / NMLS / disclaimer on a "
                    "closing slide', or 'use <realtor name>'s branding'. "
                    "Use the returned logo/headshot URLs as image values and the text fields verbatim; "
                    "never invent contact details or NMLS numbers."
                ),
                schema=NoArgsInput,
                strict=True,
            ),
            Tool(
                name="webSearch",
                description=(
                    "Search the web with Google for current, real-world information not in the "
                    "deck—recent mortgage/market rates, statistics, news, prices, dates, or facts. "
                    "Returns a concise, grounded answer. Use it whenever the user asks for "
                    "up-to-date or external information, then put the verified facts into slide "
                    "content. Do not guess at time-sensitive numbers."
                ),
                schema=WebSearchInput,
                strict=True,
            ),
            Tool(
                name="getAvailableLayouts",
                description=(
                    "List slide layout ids/descriptions for the presentation template. "
                    "This is for content structure/layout selection only, not color themes."
                ),
                schema=NoArgsInput,
                strict=True,
            ),
            Tool(
                name="getContentSchemaFromLayoutId",
                description=(
                    "Fetch the JSON content schema for a layout id. Use before "
                    "saving slide content to validate structure."
                ),
                schema=GetContentSchemaFromLayoutIdInput,
                strict=True,
            ),
            Tool(
                name="generateAssets",
                description=(
                    "Generate multiple media assets in one call. Use for all slide "
                    "images and icons before saving content; include every needed "
                    "asset in the assets array instead of calling image/icon tools "
                    "one at a time."
                ),
                schema=GenerateAssetsInput,
                strict=True,
            ),
            Tool(
                name="saveSlide",
                description=(
                    "Save slide content for a layout. If replaceOldSlideAtIndex is "
                    "true, replace that index; otherwise insert as a new slide. "
                    "Pass content as a JSON-serialized object string and the server "
                    "will validate it against layout schema before save. "
                    "Returns saved:false with validation_errors when limits are exceeded—"
                    "typically shorten strings to satisfy maxLength, then call saveSlide again."
                ),
                schema=SaveSlideInput,
                strict=True,
            ),
            Tool(
                name="deleteSlide",
                description=(
                    "Delete an existing slide by zero-based index and reindex the "
                    "remaining slides. Use when the user asks to remove a slide."
                ),
                schema=DeleteSlideInput,
                strict=True,
            ),
            Tool(
                name="setPresentationTheme",
                description=(
                    "Change the deck theme using user-friendly requests like "
                    "'dark', 'light', theme name/id, or 'another'. "
                    "Can also apply customTheme payloads with colors/fonts and "
                    "optionally save them for reuse. Applies theme at presentation level. "
                    "Only use this when the user explicitly asks to change/apply/switch theme."
                ),
                schema=SetPresentationThemeInput,
                strict=True,
            ),
        ]

    async def execute_tool_call(self, tool_call: AssistantToolCall) -> dict[str, Any]:
        handler = self._tool_handlers.get(tool_call.name)
        if not handler:
            return {
                "ok": False,
                "tool": tool_call.name,
                "error": f"Unsupported tool: {tool_call.name}",
            }

        try:
            parsed_args = self._parse_args(tool_call.arguments)
            LOGGER.info("Executing chat tool %s", tool_call.name)
            result = await handler(parsed_args)
            return {"ok": True, "tool": tool_call.name, "result": result}
        except Exception as exc:
            LOGGER.exception("Chat tool failed: %s", tool_call.name)
            return {
                "ok": False,
                "tool": tool_call.name,
                "error": str(exc),
            }

    async def _get_presentation_outline(self, _: dict[str, Any]) -> dict[str, Any]:
        outline = await self._memory.get("presentation_outline")
        if not isinstance(outline, dict):
            return {
                "found": False,
                "message": "Presentation outline is not available in memory yet.",
                "sections": [],
            }

        slides = outline.get("slides")
        if not isinstance(slides, list) or not slides:
            return {
                "found": False,
                "message": "Presentation outline exists but has no slides.",
                "sections": [],
            }

        sections: list[dict[str, Any]] = []
        for position, slide in enumerate(slides):
            index = position
            content = ""
            if isinstance(slide, dict):
                raw_index = slide.get("index")
                if isinstance(raw_index, int):
                    index = raw_index
                raw_content = slide.get("content")
                if isinstance(raw_content, str):
                    content = raw_content
                elif raw_content is not None:
                    try:
                        content = json.dumps(raw_content, ensure_ascii=False)
                    except Exception:
                        content = str(raw_content)
            elif isinstance(slide, str):
                content = slide

            title = self._extract_title(content) or f"Slide {index + 1}"
            sections.append(
                {
                    "index": index,
                    "slide_number": index + 1,
                    "title": title,
                }
            )

        return {
            "found": True,
            "slide_count": len(sections),
            "sections": sections,
            "source": outline.get("source", "memory"),
        }

    async def _search_slides(self, args: dict[str, Any]) -> dict[str, Any]:
        payload = SearchSlidesInput(**args)
        results = await self._memory.search(payload.query, payload.limit)
        return {
            "query": payload.query,
            "count": len(results),
            "results": results,
        }

    async def _get_slide_at_index(self, args: dict[str, Any]) -> dict[str, Any]:
        normalized_args = dict(args)
        normalized_args.setdefault("includeFullContent", False)
        payload = GetSlideAtIndexInput(**normalized_args)
        slide = await self._memory.get_slide_at_index(
            payload.index,
            include_full_content=payload.include_full_content,
        )
        if not slide and payload.index > 0:
            # Users often refer to slides as 1-based; allow a safe fallback.
            fallback_index = payload.index - 1
            fallback_slide = await self._memory.get_slide_at_index(
                fallback_index,
                include_full_content=payload.include_full_content,
            )
            if fallback_slide:
                return {
                    "found": True,
                    "slide": fallback_slide,
                    "requested_index": payload.index,
                    "resolved_index": fallback_index,
                    "note": (
                        "No slide found at requested index; returned one-based fallback "
                        f"at index {fallback_index}."
                    ),
                }
        if not slide:
            return {
                "found": False,
                "message": f"No slide found at index {payload.index}.",
            }
        return {
            "found": True,
            "slide": slide,
        }

    async def _get_branding_profiles(self, _: dict[str, Any]) -> dict[str, Any]:
        user_profile = self._sanitize_brand(self._branding)
        partner_profiles: list[dict[str, Any]] = []
        for partner in self._partners or []:
            sanitized = self._sanitize_brand(partner)
            if sanitized:
                partner_profiles.append(sanitized)

        if not user_profile and not partner_profiles:
            return {
                "found": False,
                "message": (
                    "No branding was provided for this session. Ask the user to set their "
                    "branding in their profile settings, then try again."
                ),
                "user": None,
                "partners": [],
            }

        return {
            "found": True,
            "user": user_profile,
            "partners": partner_profiles,
            "message": (
                "Use these real values on slides: put logo_url/headshot_url into image fields "
                "and the text fields (name, company, title, email, phone, nmls, disclaimer, etc.) "
                "verbatim. Do not invent or alter contact details, NMLS, license, or disclaimers."
            ),
        }

    async def _web_search(self, args: dict[str, Any]) -> dict[str, Any]:
        payload = WebSearchInput(**args)
        # Run an isolated, Google-grounded generation (no function tools) so the
        # built-in search tool never has to coexist with our function tools in the
        # same request — Gemini does not reliably allow that combination.
        from llmai import WebSearchTool, get_client
        from llmai.shared import SystemMessage, UserMessage
        from utils.llm_config import get_llm_config
        from utils.llm_provider import get_model
        from utils.llm_utils import extract_text

        client = get_client(config=get_llm_config())
        model = get_model()

        def _run() -> Any:
            return client.generate(
                model=model,
                messages=[
                    SystemMessage(
                        content=(
                            "You are a web research assistant. Use Google Search to answer with "
                            "current, factual information. Be concise; include key numbers, dates, "
                            "and the source site(s)."
                        )
                    ),
                    UserMessage(content=payload.query),
                ],
                tools=[WebSearchTool()],
            )

        response = await asyncio.to_thread(_run)
        answer = (extract_text(response.content) or "").strip()
        if len(answer) > 4000:
            answer = answer[:4000] + "…"
        return {
            "query": payload.query,
            "answer": answer or "No results found.",
        }

    # Whitelist of branding keys safe/useful to expose to the model. Maps several
    # incoming field-name variants (broker user branding + partner records) to a
    # single clean output key. Image data is exposed only as URLs (never base64).
    _BRAND_FIELD_MAP: dict[str, tuple[str, ...]] = {
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

    @classmethod
    def _sanitize_brand(cls, raw: Any) -> dict[str, Any] | None:
        if not isinstance(raw, dict):
            return None

        def clean_str(value: Any, limit: int = 2000) -> str | None:
            if not isinstance(value, str):
                return None
            text = value.strip()
            if not text or len(text) > limit:
                # Drop empties and oversized values (e.g. inlined base64 blobs).
                return None
            return text

        profile: dict[str, Any] = {}
        for out_key, in_keys in cls._BRAND_FIELD_MAP.items():
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
                if isinstance(key, str) and clean_str(value)
            }
            socials = {k: v for k, v in socials.items() if v}
            if socials:
                profile["social_links"] = socials

        return profile or None

    async def _get_available_layouts(self, _: dict[str, Any]) -> dict[str, Any]:
        layouts = await self._memory.get_available_layouts()
        return {
            "count": len(layouts),
            "layouts": layouts,
        }

    async def _get_presentation_theme_catalog(
        self, _: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._memory.get_presentation_theme_catalog()

    async def _get_content_schema_from_layout_id(
        self, args: dict[str, Any]
    ) -> dict[str, Any]:
        payload = GetContentSchemaFromLayoutIdInput(**args)
        schema = await self._memory.get_content_schema_from_layout_id(payload.layout_id)
        if schema is None:
            return {
                "found": False,
                "layout_id": payload.layout_id,
                "message": "Layout schema not found for the provided layout id.",
            }
        return {
            "found": True,
            "layout_id": payload.layout_id,
            "content_schema": schema,
        }

    async def _generate_image(self, args: dict[str, Any]) -> dict[str, Any]:
        payload = GenerateImageInput(**args)
        image_url = await self._memory.generate_image(payload.prompt)
        return {
            "prompt": payload.prompt,
            "url": image_url,
        }

    async def _generate_icon(self, args: dict[str, Any]) -> dict[str, Any]:
        payload = GenerateIconInput(**args)
        icon_url = await self._memory.generate_icon(payload.query)
        return {
            "query": payload.query,
            "url": icon_url,
        }

    async def _generate_assets(self, args: dict[str, Any]) -> dict[str, Any]:
        payload = GenerateAssetsInput(**args)
        generated_assets: list[dict[str, Any]] = []

        for index, asset in enumerate(payload.assets):
            if asset.kind == "image":
                result = await self._generate_image({"prompt": asset.prompt})
            else:
                result = await self._generate_icon({"query": asset.prompt})

            generated_assets.append(
                {
                    "index": index,
                    "kind": asset.kind,
                    "prompt": asset.prompt,
                    "url": result.get("url"),
                }
            )

        return {
            "count": len(generated_assets),
            "assets": generated_assets,
            "message": f"Generated {len(generated_assets)} asset(s).",
        }

    async def _save_slide(self, args: dict[str, Any]) -> dict[str, Any]:
        payload_args = json.loads(json.dumps(dict(args), ensure_ascii=False))
        raw_content = payload_args.get("content")
        if isinstance(raw_content, dict):
            payload_args["content"] = json.dumps(raw_content, ensure_ascii=False)

        payload = SaveSlideInput(**payload_args)
        try:
            content_parsed: Any = dirtyjson.loads(payload.content)
        except Exception:
            content_parsed = json.loads(payload.content)

        if not isinstance(content_parsed, dict):
            raise ValueError("'content' must be a JSON object.")

        content_payload = json.loads(json.dumps(content_parsed, ensure_ascii=False))
        return await self._memory.save_slide(
            content=content_payload,
            layout_id=payload.layout_id,
            index=payload.index,
            replace_old_slide_at_index=payload.replace_old_slide_at_index,
        )

    async def _delete_slide(self, args: dict[str, Any]) -> dict[str, Any]:
        payload = DeleteSlideInput(**args)
        return await self._memory.delete_slide(index=payload.index)

    async def _set_presentation_theme(self, args: dict[str, Any]) -> dict[str, Any]:
        payload = SetPresentationThemeInput(**args)
        return await self._memory.set_presentation_theme(
            theme_query=payload.theme,
            custom_theme=(
                payload.custom_theme.model_dump(exclude_none=True)
                if payload.custom_theme is not None
                else None
            ),
            save_custom_theme=bool(payload.save_custom_theme),
        )

    @staticmethod
    def _parse_args(arguments: str | None) -> dict[str, Any]:
        if not arguments:
            return {}

        try:
            parsed = dirtyjson.loads(arguments)
        except Exception:
            parsed = json.loads(arguments)

        normalized = json.loads(json.dumps(parsed, ensure_ascii=False))
        if isinstance(normalized, dict):
            return normalized

        raise ValueError("Tool arguments must be a JSON object.")

    @staticmethod
    def _extract_title(markdown_content: str) -> str:
        for line in markdown_content.splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            heading_match = re.match(r"^#{1,6}\s*(.+?)\s*$", stripped)
            if heading_match:
                return heading_match.group(1).strip()
            return stripped[:120]
        return ""

    @staticmethod
    def _truncate(value: str, limit: int) -> str:
        if len(value) <= limit:
            return value
        return f"{value[:limit]}..."
