import asyncio
import uuid

from models.chat import ChatMessageRequest
from models.sql.presentation import PresentationModel, PresentationVersion
from models.sql.slide import SlideModel
from services.chat.memory_layer import PresentationChatMemoryLayer
from services.chat.prompts import build_system_prompt
from services.chat.tools import ChatTools


VALID_SMART_HTML = (
    '<section data-slide-type="content" data-slide-title="Updated title" '
    'class="relative h-[720px] w-[1280px] overflow-hidden bg-white">'
    '<h2 class="text-5xl">Updated title</h2></section>'
)


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def __iter__(self):
        return iter(self._rows)


class _SmartSession:
    def __init__(self, presentation, slides):
        self.presentation = presentation
        self.slides = slides
        self.added = []
        self.commit_count = 0

    async def get(self, model, object_id):
        if model is PresentationModel and object_id == self.presentation.id:
            return self.presentation
        return None

    async def scalar(self, _statement):
        return self.slides[0] if self.slides else None

    async def scalars(self, _statement):
        return _Rows(self.slides)

    def add(self, value):
        self.added.append(value)

    async def commit(self):
        self.commit_count += 1

    async def refresh(self, _value):
        return None


def _smart_presentation(presentation_id):
    return PresentationModel(
        id=presentation_id,
        version=PresentationVersion.V2_STANDARD,
        content="Smart deck",
        n_slides=1,
        language="English",
        title="Smart deck",
        generation_mode="smart",
    )


def test_chat_request_accepts_smart_presentation_type():
    payload = ChatMessageRequest(
        presentation_id=uuid.uuid4(),
        presentation_type="smart",
        message="Shorten slide 1",
    )

    assert payload.presentation_type == "smart"


def test_smart_prompt_requires_full_validated_html_replacement():
    prompt = build_system_prompt("", "", presentation_type="smart")

    assert "complete replacement HTML fragment" in prompt
    assert "includeFullContent=true" in prompt
    assert "replaceOldSlideAtIndex=true" in prompt
    assert "template layout/schema/component" in prompt


def test_smart_chat_exposes_only_html_appropriate_tools():
    class _Memory:
        presentation_type = "smart"

    tool_names = {
        tool.name for tool in ChatTools(_Memory()).get_tool_definitions()
    }

    assert {
        "getSmartPresentationContext",
        "getSlideAtIndex",
        "searchSlide",
        "saveSlide",
        "deleteSlide",
    }.issubset(tool_names)
    assert "updateElement" not in tool_names
    assert "getAvailableLayouts" not in tool_names
    assert "addOutline" not in tool_names


def test_smart_slide_read_returns_authoritative_html():
    presentation_id = uuid.uuid4()
    presentation = _smart_presentation(presentation_id)
    slide = SlideModel(
        presentation=presentation_id,
        layout_group="smart-html",
        layout="smart-html",
        index=0,
        content={"title": "Original"},
        html_content=VALID_SMART_HTML,
        speaker_note="",
    )
    memory = PresentationChatMemoryLayer(
        _SmartSession(presentation, [slide]),
        presentation_id,
        presentation_type="smart",
    )

    result = asyncio.run(memory.get_slide_at_index(0, include_full_content=True))

    assert result is not None
    assert result["format"] == "html"
    assert result["html"] == VALID_SMART_HTML
    assert "Updated title" in result["html_text_preview"]


def test_smart_slide_save_validates_and_replaces_html():
    presentation_id = uuid.uuid4()
    presentation = _smart_presentation(presentation_id)
    slide = SlideModel(
        presentation=presentation_id,
        layout_group="smart-html",
        layout="smart-html",
        index=0,
        content={"title": "Original"},
        html_content=(
            '<section class="relative h-[720px] w-[1280px] overflow-hidden">'
            "<h2>Original</h2></section>"
        ),
        speaker_note="",
    )
    session = _SmartSession(presentation, [slide])
    memory = PresentationChatMemoryLayer(
        session,
        presentation_id,
        presentation_type="smart",
    )

    result = asyncio.run(
        memory.save_html_slide(
            html=VALID_SMART_HTML,
            index=0,
            replace_old_slide_at_index=True,
        )
    )

    assert result["saved"] is True
    assert slide.html_content == VALID_SMART_HTML
    assert slide.content == {"title": "Updated title"}
    assert slide.ui is None
    assert session.commit_count == 1


def test_smart_slide_save_rejects_invalid_canvas():
    presentation_id = uuid.uuid4()
    presentation = _smart_presentation(presentation_id)
    session = _SmartSession(presentation, [])
    memory = PresentationChatMemoryLayer(
        session,
        presentation_id,
        presentation_type="smart",
    )

    result = asyncio.run(
        memory.save_html_slide(
            html="<section><h2>Broken</h2></section>",
            index=0,
            replace_old_slide_at_index=False,
        )
    )

    assert result["saved"] is False
    assert result["validation_errors"]
    assert session.commit_count == 0
