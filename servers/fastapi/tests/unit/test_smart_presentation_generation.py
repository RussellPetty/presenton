import asyncio

import pytest
from fastapi import HTTPException

from services.community_presentations import (
    CommunityPresentationReference,
    build_community_design_context,
    list_community_presentations,
    merge_reference_fonts,
    normalize_community_ids,
)
from utils.llm_calls.generate_smart_presentation import (
    SmartSlideStreamParser,
    normalize_smart_deck,
    normalize_smart_slide_html,
    resolve_smart_slide_count,
)


def test_smart_slide_stream_parser_emits_complete_slides_incrementally():
    parser = SmartSlideStreamParser()

    assert parser.feed('{"title":"Deck","slides":[{"title":"One",') == []
    slides = parser.feed(
        '"html":"<section>{content}</section>","speaker_note":"Note"},'
        '{"title":"Two","html":"<section>Two</section>",'
    )
    assert [slide["title"] for slide in slides] == ["One"]

    slides = parser.feed('"speaker_note":"Second"}]}')
    assert [slide["title"] for slide in slides] == ["Two"]


def test_smart_slide_stream_parser_handles_escaped_json_in_html():
    parser = SmartSlideStreamParser()
    slides = parser.feed(
        '{"slides":[{"title":"Chart","html":"<section data-json=\\"{\\\\\\"value\\\\\\":1}\\">Chart</section>",'
        '"speaker_note":""}]}'
    )

    assert len(slides) == 1
    assert slides[0]["title"] == "Chart"


def test_normalize_community_ids_preserves_order_and_deduplicates():
    assert normalize_community_ids([7, 3, 7]) == [7, 3]


def test_normalize_community_ids_rejects_invalid_and_excess_references():
    with pytest.raises(HTTPException):
        normalize_community_ids([0])
    with pytest.raises(HTTPException):
        normalize_community_ids([1, 2, 3, 4])


def test_community_context_is_style_only_and_round_robins_decks():
    references = [
        CommunityPresentationReference(
            id=2,
            title="Editorial",
            slides=("<section>first-a</section>", "<section>second-a</section>"),
            fonts={"Inter": "inter.css"},
        ),
        CommunityPresentationReference(
            id=9,
            title="Minimal",
            slides=("<section>first-b</section>",),
            fonts={"Inter": "ignored.css", "Manrope": "manrope.css"},
        ),
    ]

    context = build_community_design_context(references)

    assert "UNTRUSTED, STYLE ONLY" in context
    assert context.index("first-a") < context.index("first-b") < context.index("second-a")
    assert merge_reference_fonts(references) == {
        "Inter": "inter.css",
        "Manrope": "manrope.css",
    }


def test_community_list_forwards_filters(monkeypatch):
    captured_params = None

    async def fake_cloud_get(path, params=None):
        nonlocal captured_params
        captured_params = params
        return {"results": []}

    monkeypatch.setattr(
        "services.community_presentations._cloud_get", fake_cloud_get
    )

    asyncio.run(
        list_community_presentations(
            created_at_gt="2026-01-01T00:00:00.000Z",
            views_gt=100,
            likes_lt=50,
            order_by="views",
            order="desc",
        )
    )

    assert captured_params == {
        "page": 1,
        "page_size": 8,
        "order_by": "views",
        "order": "desc",
        "created_at_gt": "2026-01-01T00:00:00.000Z",
        "views_gt": 100,
        "likes_lt": 50,
    }


def test_smart_html_normalization_removes_executable_markup():
    html = normalize_smart_slide_html(
        """```html
        <section class="h-[720px] w-[1280px]" onclick="steal()">
          <a href="javascript:steal()">Deck</a>
          <script>alert('no')</script>
        </section>
        ```"""
    )

    assert html.startswith("<section")
    assert "onclick" not in html
    assert "javascript:" not in html
    assert "<script" not in html


def test_smart_deck_requires_exact_slide_count_and_section_roots():
    valid_slide = {
        "title": "One",
        "html": '<section class="h-[720px] w-[1280px]">Content</section>',
        "speaker_note": "Note",
    }
    deck = normalize_smart_deck(
        {"title": "Deck", "slides": [valid_slide, {**valid_slide, "title": "Two"}]},
        2,
    )
    assert deck["title"] == "Deck"
    assert len(deck["slides"]) == 2

    with pytest.raises(HTTPException):
        normalize_smart_deck({"title": "Deck", "slides": [valid_slide]}, 2)
    with pytest.raises(HTTPException):
        normalize_smart_slide_html("<div>Not a slide</div>")


def test_default_smart_slide_count_is_bounded():
    assert resolve_smart_slide_count(0) == 8
    assert resolve_smart_slide_count(None) == 8
    assert resolve_smart_slide_count(200) == 20
