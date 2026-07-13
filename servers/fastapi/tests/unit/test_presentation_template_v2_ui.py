from api.v1.ppt.endpoints import presentation as presentation_endpoint
from services.chat.memory_layer import PresentationChatMemoryLayer


def _duplicate_named_groups_ui():
    def block_group():
        return {
            "type": "group",
            "name": "numbered_text_block",
            "children": [
                {
                    "type": "text",
                    "decorative": False,
                    "name": "block_number_text",
                    "runs": [{"text": "1"}],
                },
                {
                    "type": "text",
                    "decorative": False,
                    "name": "block_heading_text",
                    "runs": [{"text": "Old heading"}],
                },
                {
                    "type": "text",
                    "decorative": False,
                    "name": "block_body_text",
                    "runs": [{"text": "Old body"}],
                },
            ],
        }

    return {
        "id": "two_column_numbered_layout",
        "components": [
            {
                "id": "numbered_content_area",
                "elements": [block_group() for _ in range(4)],
            }
        ],
    }


def _duplicate_named_groups_content():
    return {
        "numbered_content_area": {
            "numbered_text_block": {
                "block_number_text": "1",
                "block_heading_text": "Core Favorites",
                "block_body_text": "Keep fan favorites available.",
            },
            "numbered_text_block_2": {
                "block_number_text": "2",
                "block_heading_text": "Limited-Time Items",
                "block_body_text": "Rotate limited offers.",
            },
            "numbered_text_block_3": {
                "block_number_text": "3",
                "block_heading_text": "Customization",
                "block_body_text": "Let guests adjust ingredients.",
            },
            "numbered_text_block_4": {
                "block_number_text": "4",
                "block_heading_text": "Occasion Fit",
                "block_body_text": "Use combos and shareables.",
            },
        }
    }


def _duplicate_named_group_headings(ui):
    return [
        group["children"][1]["runs"][0]["text"]
        for group in ui["components"][0]["elements"]
    ]


def test_apply_template_v2_content_to_ui_uses_schema_content_keys():
    ui = {
        "id": "layout-1",
        "description": "Layout with generated content placeholders.",
        "components": [
            {
                "id": "hero",
                "description": "Hero content component.",
                "elements": [
                    {
                        "type": "text",
                        "decorative": False,
                        "name": "headline",
                        "runs": [{"text": "Old headline", "font": {"bold": True}}],
                    },
                    {
                        "type": "image",
                        "decorative": False,
                        "name": "hero_image",
                        "data": "/old-image.png",
                        "is_icon": False,
                    },
                    {
                        "type": "text-list",
                        "decorative": False,
                        "name": "bullets",
                        "items": [[{"text": "Old bullet"}]],
                    },
                    {
                        "type": "table",
                        "decorative": False,
                        "name": "metrics",
                        "columns": [{"runs": [{"text": "Old"}]}],
                        "rows": [[{"runs": [{"text": "Old value"}]}]],
                    },
                    {
                        "type": "chart",
                        "decorative": False,
                        "name": "trend",
                        "chart_type": "bar",
                        "categories": ["Old"],
                        "series": [{"name": "Old", "values": [1]}],
                    },
                    {
                        "type": "grid",
                        "name": "cards",
                        "children": [
                            {
                                "type": "group",
                                "name": "card_1",
                                "children": [
                                    {
                                        "type": "text",
                                        "decorative": False,
                                        "name": "title_1",
                                        "runs": [{"text": "Old card 1"}],
                                    },
                                    {
                                        "type": "image",
                                        "decorative": False,
                                        "name": "icon_1",
                                        "data": "/old-icon-1.svg",
                                        "is_icon": True,
                                    },
                                ],
                            },
                            {
                                "type": "group",
                                "name": "card_2",
                                "children": [
                                    {
                                        "type": "text",
                                        "decorative": False,
                                        "name": "title_2",
                                        "runs": [{"text": "Old card 2"}],
                                    },
                                    {
                                        "type": "image",
                                        "decorative": False,
                                        "name": "icon_2",
                                        "data": "/old-icon-2.svg",
                                        "is_icon": True,
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            {
                "id": "metric_card",
                "description": "First metric card.",
                "elements": [
                    {
                        "type": "text",
                        "decorative": False,
                        "name": "value",
                        "runs": [{"text": "0%"}],
                    }
                ],
            },
            {
                "id": "metric_card",
                "description": "Second metric card.",
                "elements": [
                    {
                        "type": "text",
                        "decorative": False,
                        "name": "value",
                        "runs": [{"text": "0%"}],
                    }
                ],
            },
        ],
    }
    content = {
        "hero": {
            "headline": "Generated headline",
            "hero_image": {
                "image_prompt": "Team dashboard",
                "image_url": "/app_data/images/hero.png",
            },
            "bullets": ["First generated bullet", "Second generated bullet"],
            "metrics": {
                "columns": ["Region", "Sales"],
                "rows": [["US", 12], ["EU", True]],
            },
            "trend": {
                "title": "Growth",
                "chart_type": "line",
                "categories": ["Q1", "Q2"],
                "series": [{"name": "Revenue", "values": [10, 20]}],
                "data_labels": "top",
            },
            "cards": [
                {
                    "title": "First card",
                    "icon": {"icon_query": "growth", "icon_url": "/icons/one.svg"},
                },
                {
                    "title": "Second card",
                    "icon": {"icon_query": "support", "icon_url": "/icons/two.svg"},
                },
            ],
        },
        "metric_card_0": {"value": "42%"},
        "metric_card_1": {"value": "21%"},
    }

    hydrated = presentation_endpoint._apply_template_v2_content_to_ui(ui, content)

    hero_elements = hydrated["components"][0]["elements"]
    assert hero_elements[0]["runs"] == [
        {"text": "Generated headline", "font": {"bold": True}}
    ]
    assert "text" not in hero_elements[0]
    assert hero_elements[1]["data"] == "/app_data/images/hero.png"
    assert hero_elements[1]["prompt"] == "Team dashboard"
    assert hero_elements[2]["items"] == [
        [{"text": "First generated bullet"}],
        [{"text": "Second generated bullet"}],
    ]
    assert hero_elements[3]["columns"][0]["runs"][0]["text"] == "Region"
    assert hero_elements[3]["rows"][0][1]["runs"][0]["text"] == "12"
    assert hero_elements[3]["rows"][1][1]["runs"][0]["text"] == "true"
    assert hero_elements[4]["chart_type"] == "line"
    assert hero_elements[4]["categories"] == ["Q1", "Q2"]
    assert hero_elements[4]["data_labels"] == "top"

    cards = hero_elements[5]["children"]
    assert cards[0]["children"][0]["runs"][0]["text"] == "First card"
    assert cards[0]["children"][1]["data"] == "/icons/one.svg"
    assert cards[0]["children"][1]["prompt"] == "growth"
    assert cards[1]["children"][0]["runs"][0]["text"] == "Second card"
    assert cards[1]["children"][1]["data"] == "/icons/two.svg"
    assert cards[1]["children"][1]["prompt"] == "support"

    assert hydrated["components"][1]["elements"][0]["runs"][0]["text"] == "42%"
    assert hydrated["components"][2]["elements"][0]["runs"][0]["text"] == "21%"
    assert "text" not in hydrated["components"][1]["elements"][0]
    assert "text" not in hydrated["components"][2]["elements"][0]
    assert ui["components"][0]["elements"][0]["runs"][0]["text"] == "Old headline"


def test_apply_template_v2_content_to_ui_uses_suffixed_content_for_duplicate_group_names():
    hydrated = presentation_endpoint._apply_template_v2_content_to_ui(
        _duplicate_named_groups_ui(),
        _duplicate_named_groups_content(),
    )

    assert _duplicate_named_group_headings(hydrated) == [
        "Core Favorites",
        "Limited-Time Items",
        "Customization",
        "Occasion Fit",
    ]
    assert [
        group["children"][0]["runs"][0]["text"]
        for group in hydrated["components"][0]["elements"]
    ] == ["1", "2", "3", "4"]


def test_chat_template_v2_content_uses_suffixed_content_for_duplicate_group_names():
    ui = _duplicate_named_groups_ui()

    PresentationChatMemoryLayer._apply_template_v2_content_to_ui(
        ui,
        _duplicate_named_groups_content(),
    )

    assert _duplicate_named_group_headings(ui) == [
        "Core Favorites",
        "Limited-Time Items",
        "Customization",
        "Occasion Fit",
    ]


def test_apply_template_v2_content_to_ui_handles_empty_text_runs():
    ui = {
        "id": "layout-1",
        "components": [
            {
                "id": "hero",
                "elements": [
                    {
                        "type": "text",
                        "decorative": False,
                        "name": "headline",
                        "font": {"size": 24},
                        "runs": [],
                    },
                    {
                        "type": "table",
                        "decorative": False,
                        "name": "metrics",
                        "columns": [{"font": {"size": 10}, "runs": []}],
                        "rows": [[{"font": {"size": 9}, "runs": []}]],
                    },
                ],
            }
        ],
    }
    content = {
        "hero": {
            "headline": "Generated headline",
            "metrics": {
                "columns": ["Metric"],
                "rows": [["Revenue"]],
            },
        }
    }

    hydrated = presentation_endpoint._apply_template_v2_content_to_ui(ui, content)

    elements = hydrated["components"][0]["elements"]
    assert elements[0]["runs"] == [{"text": "Generated headline", "font": {"size": 24}}]
    assert elements[1]["columns"][0]["runs"] == [
        {"text": "Metric", "font": {"size": 10}}
    ]
    assert elements[1]["rows"][0][0]["runs"] == [
        {"text": "Revenue", "font": {"size": 9}}
    ]


def test_chat_template_v2_content_hydration_updates_nested_blocks_and_tables():
    ui = {
        "id": "layout-1",
        "components": [
            {
                "id": "hero",
                "elements": [
                    {
                        "type": "text",
                        "decorative": False,
                        "name": "headline",
                        "runs": [{"text": "Old headline"}],
                    },
                    {
                        "type": "grid",
                        "name": "cards",
                        "children": [
                            {
                                "type": "group",
                                "name": "card_1",
                                "children": [
                                    {
                                        "type": "text",
                                        "decorative": False,
                                        "name": "title_1",
                                        "runs": [{"text": "Old card"}],
                                    },
                                    {
                                        "type": "image",
                                        "decorative": False,
                                        "name": "icon_1",
                                        "data": "/old.svg",
                                        "is_icon": True,
                                    },
                                ],
                            }
                        ],
                    },
                    {
                        "type": "table",
                        "decorative": False,
                        "name": "metrics",
                        "columns": [{"runs": [{"text": "Old column"}]}],
                        "rows": [[{"runs": [{"text": "Old value"}]}]],
                    },
                ],
            }
        ],
    }

    PresentationChatMemoryLayer._apply_template_v2_content_to_ui(
        ui,
        {
            "hero": {
                "headline": "Generated headline",
                "cards": [
                    {
                        "title": "Revenue up",
                        "icon": {
                            "icon_query": "growth",
                            "icon_url": "/app_data/icons/growth.svg",
                        },
                    }
                ],
                "metrics": {
                    "columns": ["Metric", "Value"],
                    "rows": [["Revenue", 42]],
                },
            }
        },
    )

    elements = ui["components"][0]["elements"]
    assert elements[0]["runs"][0]["text"] == "Generated headline"
    assert elements[1]["children"][0]["children"][0]["runs"][0]["text"] == "Revenue up"
    assert elements[1]["children"][0]["children"][1]["data"] == "/app_data/icons/growth.svg"
    assert elements[1]["children"][0]["children"][1]["prompt"] == "growth"
    assert elements[2]["columns"][0]["runs"][0]["text"] == "Metric"
    assert elements[2]["columns"][1]["runs"][0]["text"] == "Value"
    assert elements[2]["rows"][0][0]["runs"][0]["text"] == "Revenue"
    assert elements[2]["rows"][0][1]["runs"][0]["text"] == "42"


def test_apply_template_v2_content_to_ui_parses_markdown_text_to_runs():
    ui = {
        "id": "layout-1",
        "description": "Layout with markdown generated content placeholders.",
        "components": [
            {
                "id": "hero",
                "description": "Hero content component.",
                "elements": [
                    {
                        "type": "text",
                        "decorative": False,
                        "name": "headline",
                        "runs": [
                            {
                                "text": "Old headline",
                                "font": {"family": "Inter", "size": 24},
                            }
                        ],
                    },
                    {
                        "type": "text-list",
                        "decorative": False,
                        "name": "bullets",
                        "items": [
                            [
                                {
                                    "text": "Old bullet",
                                    "font": {"color": "#111111", "size": 14},
                                }
                            ]
                        ],
                    },
                    {
                        "type": "table",
                        "decorative": False,
                        "name": "metrics",
                        "columns": [
                            {
                                "font": {"size": 10},
                                "runs": [
                                    {
                                        "text": "Old column",
                                        "font": {"size": 10},
                                    }
                                ],
                            }
                        ],
                        "rows": [
                            [
                                {
                                    "runs": [
                                        {
                                            "text": "Old value",
                                            "font": {"size": 9},
                                        }
                                    ]
                                }
                            ]
                        ],
                    },
                ],
            }
        ],
    }
    content = {
        "hero": {
            "headline": "AI **agents** need _memory_",
            "bullets": [
                "Keep **scope** tight",
                "Ship *incrementally*",
            ],
            "metrics": {
                "columns": ["__Metric__"],
                "rows": [["*Retention*"]],
            },
        }
    }

    hydrated = presentation_endpoint._apply_template_v2_content_to_ui(ui, content)

    elements = hydrated["components"][0]["elements"]
    assert elements[0]["runs"] == [
        {"text": "AI ", "font": {"family": "Inter", "size": 24}},
        {
            "text": "agents",
            "font": {"family": "Inter", "size": 24, "bold": True},
        },
        {"text": " need ", "font": {"family": "Inter", "size": 24}},
        {
            "text": "memory",
            "font": {"family": "Inter", "size": 24, "italic": True},
        },
    ]
    assert elements[1]["items"] == [
        [
            {"text": "Keep ", "font": {"color": "#111111", "size": 14}},
            {
                "text": "scope",
                "font": {"color": "#111111", "size": 14, "bold": True},
            },
            {"text": " tight", "font": {"color": "#111111", "size": 14}},
        ],
        [
            {"text": "Ship "},
            {
                "text": "incrementally",
                "font": {"italic": True},
            },
        ],
    ]
    assert elements[2]["columns"][0]["runs"] == [
        {"text": "Metric", "font": {"size": 10, "bold": True}}
    ]
    assert elements[2]["rows"][0][0]["runs"] == [
        {"text": "Retention", "font": {"size": 9, "italic": True}}
    ]


def test_apply_template_v2_content_to_ui_markdown_overrides_inherited_emphasis():
    ui = {
        "id": "layout-1",
        "components": [
            {
                "id": "information_card_grid",
                "elements": [
                    {
                        "type": "group",
                        "name": "information_card",
                        "children": [
                            {
                                "type": "text",
                                "decorative": False,
                                "name": "card_body",
                                "font": {
                                    "size": 21.33,
                                    "family": "HK Grotesk",
                                    "color": "#1E1E1E",
                                    "wrap": "word",
                                },
                                "runs": [
                                    {
                                        "text": "Old body",
                                        "font": {
                                            "size": 21.33,
                                            "family": "HK Grotesk",
                                            "color": "#1E1E1E",
                                            "bold": True,
                                        },
                                    }
                                ],
                            }
                        ],
                    }
                ],
            }
        ],
    }
    content = {
        "information_card_grid": {
            "card_body": "**Digital ordering** supports quick, easy meals."
        }
    }

    hydrated = presentation_endpoint._apply_template_v2_content_to_ui(ui, content)

    text_element = hydrated["components"][0]["elements"][0]["children"][0]
    assert text_element["runs"] == [
        {
            "text": "Digital ordering",
            "font": {
                "size": 21.33,
                "family": "HK Grotesk",
                "color": "#1E1E1E",
                "wrap": "word",
                "bold": True,
            },
        },
        {
            "text": " supports quick, easy meals.",
            "font": {
                "size": 21.33,
                "family": "HK Grotesk",
                "color": "#1E1E1E",
                "wrap": "word",
            },
        },
    ]


def test_apply_template_v2_content_to_ui_keeps_markdown_run_whitespace():
    ui = {
        "id": "layout-1",
        "description": "Layout with markdown spacing edge cases.",
        "components": [
            {
                "id": "left_header_block",
                "description": "Header content component.",
                "elements": [
                    {
                        "type": "text",
                        "decorative": False,
                        "name": "introductory_paragraph",
                        "runs": [
                            {
                                "text": "Old paragraph",
                                "font": {
                                    "family": "Public Sans",
                                    "size": 18.68,
                                    "color": "#1A1A1A",
                                    "line_height": 1.45,
                                    "wrap": "word",
                                },
                            }
                        ],
                    },
                    {
                        "type": "text",
                        "decorative": False,
                        "name": "compact_boundary",
                        "runs": [
                            {
                                "text": "Old compact text",
                                "font": {"family": "Inter", "size": 24},
                            }
                        ],
                    },
                ],
            }
        ],
    }
    content = {
        "left_header_block": {
            "introductory_paragraph": (
                "Taco Bell's identity centers on **convenience, affordability, "
                "bold flavors,** and a casual experience that feels playful, "
                "accessible, and easy to customize."
            ),
            "compact_boundary": "Use **guided**selling with *agentic*workflows",
        }
    }

    hydrated = presentation_endpoint._apply_template_v2_content_to_ui(ui, content)

    elements = hydrated["components"][0]["elements"]
    assert elements[0]["runs"] == [
        {
            "text": "Taco Bell's identity centers on ",
            "font": {
                "family": "Public Sans",
                "size": 18.68,
                "color": "#1A1A1A",
                "line_height": 1.45,
                "wrap": "word",
            },
        },
        {
            "text": "convenience, affordability, bold flavors,",
            "font": {
                "family": "Public Sans",
                "size": 18.68,
                "color": "#1A1A1A",
                "line_height": 1.45,
                "wrap": "word",
                "bold": True,
            },
        },
        {
            "text": " and a casual experience that feels playful, accessible, and easy to customize.",
            "font": {
                "family": "Public Sans",
                "size": 18.68,
                "color": "#1A1A1A",
                "line_height": 1.45,
                "wrap": "word",
            },
        },
    ]
    assert elements[1]["runs"] == [
        {"text": "Use ", "font": {"family": "Inter", "size": 24}},
        {
            "text": "guided",
            "font": {"family": "Inter", "size": 24, "bold": True},
        },
        {"text": "selling with ", "font": {"family": "Inter", "size": 24}},
        {
            "text": "agentic",
            "font": {"family": "Inter", "size": 24, "italic": True},
        },
        {"text": "workflows", "font": {"family": "Inter", "size": 24}},
    ]


def test_template_v2_markdown_text_runs_keep_source_boundary_spaces():
    runs = presentation_endpoint._template_v2_text_runs_from_markdown(
        "Hello **how are you?** and",
        {"font": {"family": "Inter", "size": 24}},
    )

    assert runs == [
        {"text": "Hello ", "font": {"family": "Inter", "size": 24}},
        {
            "text": "how are you?",
            "font": {"family": "Inter", "size": 24, "bold": True},
        },
        {"text": " and", "font": {"family": "Inter", "size": 24}},
    ]


def test_chat_template_v2_image_content_stores_prompt():
    image = {
        "type": "image",
        "decorative": False,
        "name": "hero_image",
        "data": "/old-image.png",
        "is_icon": False,
    }
    PresentationChatMemoryLayer._set_template_v2_element_value(
        image,
        {
            "image_prompt": "Analytics dashboard",
            "image_url": "/app_data/images/dashboard.png",
        },
    )

    assert image["data"] == "/app_data/images/dashboard.png"
    assert image["prompt"] == "Analytics dashboard"

    icon = {
        "type": "image",
        "decorative": False,
        "name": "status_icon",
        "data": "/old-icon.svg",
        "is_icon": True,
    }
    PresentationChatMemoryLayer._set_template_v2_element_value(
        icon,
        {
            "icon_query": "success check",
            "icon_url": "/icons/check.svg",
        },
    )

    assert icon["data"] == "/icons/check.svg"
    assert icon["prompt"] == "success check"


def test_apply_template_v2_content_to_ui_uses_raw_schema_icon_query_url():
    ui = {
        "id": "layout-1",
        "components": [
            {
                "id": "hero",
                "elements": [
                    {
                        "type": "image",
                        "decorative": False,
                        "name": "status_icon",
                        "data": "/static/icons/placeholder.svg",
                        "is_icon": True,
                    }
                ],
            }
        ],
    }

    hydrated = presentation_endpoint._apply_template_v2_content_to_ui(
        ui,
        {
            "hero": {
                "status_icon": {
                    "query": "growth chart",
                    "icon_url": "/static/icons/regular/trend-up.svg",
                }
            }
        },
    )

    icon = hydrated["components"][0]["elements"][0]
    assert icon["data"] == "/static/icons/regular/trend-up.svg"
    assert icon["prompt"] == "growth chart"


def test_apply_template_v2_content_to_ui_matches_repeated_content_lengths():
    ui = {
        "id": "layout-1",
        "description": "Layout with repeated generated content.",
        "components": [
            {
                "id": "repeated",
                "description": "Repeated content component.",
                "elements": [
                    {
                        "type": "flex",
                        "name": "flex_cards",
                        "min_children": 2,
                        "max_children": 3,
                        "children": [
                            {
                                "type": "group",
                                "name": "flex_card_1",
                                "children": [
                                    {
                                        "type": "text",
                                        "decorative": False,
                                        "name": "title_1",
                                        "runs": [{"text": "Flex one"}],
                                    }
                                ],
                            },
                            {
                                "type": "group",
                                "name": "flex_card_2",
                                "children": [
                                    {
                                        "type": "text",
                                        "decorative": False,
                                        "name": "title_2",
                                        "runs": [{"text": "Flex two"}],
                                    }
                                ],
                            },
                            {
                                "type": "group",
                                "name": "flex_card_3",
                                "children": [
                                    {
                                        "type": "text",
                                        "decorative": False,
                                        "name": "title_3",
                                        "runs": [{"text": "Flex three"}],
                                    }
                                ],
                            },
                        ],
                    },
                    {
                        "type": "grid",
                        "name": "grid_cards",
                        "min_children": 2,
                        "max_children": 3,
                        "children": [
                            {
                                "type": "group",
                                "name": "grid_card_1",
                                "children": [
                                    {
                                        "type": "text",
                                        "decorative": False,
                                        "name": "title_1",
                                        "runs": [{"text": "Grid one"}],
                                    }
                                ],
                            },
                            {
                                "type": "group",
                                "name": "grid_card_2",
                                "children": [
                                    {
                                        "type": "text",
                                        "decorative": False,
                                        "name": "title_2",
                                        "runs": [{"text": "Grid two"}],
                                    }
                                ],
                            },
                            {
                                "type": "group",
                                "name": "grid_card_3",
                                "children": [
                                    {
                                        "type": "text",
                                        "decorative": False,
                                        "name": "title_3",
                                        "runs": [{"text": "Grid three"}],
                                    }
                                ],
                            },
                        ],
                    },
                    {
                        "type": "text-list",
                        "decorative": False,
                        "name": "bullets",
                        "min_items": 2,
                        "max_items": 3,
                        "items": [
                            [{"text": "Bullet one"}],
                            [{"text": "Bullet two"}],
                            [{"text": "Bullet three"}],
                        ],
                    },
                ],
            }
        ],
    }
    content = {
        "repeated": {
            "flex_cards": [
                {"title": "Generated flex one"},
                {"title": "Generated flex two"},
            ],
            "grid_cards": [
                {"title": "Generated grid one"},
                {"title": "Generated grid two"},
            ],
            "bullets": ["Generated bullet one", "Generated bullet two"],
        }
    }

    hydrated = presentation_endpoint._apply_template_v2_content_to_ui(ui, content)

    elements = hydrated["components"][0]["elements"]
    flex_children = elements[0]["children"]
    grid_children = elements[1]["children"]
    text_list_items = elements[2]["items"]

    assert len(flex_children) == 2
    assert flex_children[0]["children"][0]["runs"][0]["text"] == "Generated flex one"
    assert flex_children[1]["children"][0]["runs"][0]["text"] == "Generated flex two"
    assert len(grid_children) == 2
    assert grid_children[0]["children"][0]["runs"][0]["text"] == "Generated grid one"
    assert grid_children[1]["children"][0]["runs"][0]["text"] == "Generated grid two"
    assert text_list_items == [
        [{"text": "Generated bullet one"}],
        [{"text": "Generated bullet two"}],
    ]


def test_apply_template_v2_content_to_ui_hydrates_direct_repeated_images():
    ui = {
        "id": "layout-1",
        "components": [
            {
                "id": "gallery",
                "elements": [
                    {
                        "type": "grid",
                        "name": "photo_panels",
                        "children": [
                            {
                                "type": "image",
                                "decorative": False,
                                "name": "gallery_photo_panel",
                                "data": "/static/images/replaceable_template_image.png",
                                "is_icon": False,
                            }
                            for _ in range(3)
                        ],
                    }
                ],
            }
        ],
    }
    content = {
        "gallery": {
            "photo_panels": [
                {
                    "image_prompt": "Melting glacier",
                    "image_url": "/app_data/images/glacier.png",
                },
                {
                    "image_prompt": "Wildfire smoke",
                    "image_url": "/app_data/images/wildfire.png",
                },
                {
                    "image_prompt": "Flooded street",
                    "image_url": "/static/images/placeholder.jpg",
                },
            ]
        }
    }

    hydrated = presentation_endpoint._apply_template_v2_content_to_ui(ui, content)

    images = hydrated["components"][0]["elements"][0]["children"]
    assert [image["data"] for image in images] == [
        "/app_data/images/glacier.png",
        "/app_data/images/wildfire.png",
        "/static/images/placeholder.jpg",
    ]
    assert [image["prompt"] for image in images] == [
        "Melting glacier",
        "Wildfire smoke",
        "Flooded street",
    ]


def test_chat_template_v2_content_hydrates_direct_repeated_images():
    ui = {
        "components": [
            {
                "id": "gallery",
                "elements": [
                    {
                        "type": "grid",
                        "name": "photo_panels",
                        "children": [
                            {
                                "type": "image",
                                "decorative": False,
                                "name": "gallery_photo_panel",
                                "data": "/static/images/replaceable_template_image.png",
                                "is_icon": False,
                            }
                        ],
                    }
                ],
            }
        ]
    }

    PresentationChatMemoryLayer._apply_template_v2_content_to_ui(
        ui,
        {
            "gallery": {
                "photo_panels": [
                    {
                        "image_prompt": "Generated landscape",
                        "image_url": "/app_data/images/landscape.png",
                    }
                ]
            }
        },
    )

    image = ui["components"][0]["elements"][0]["children"][0]
    assert image["data"] == "/app_data/images/landscape.png"
    assert image["prompt"] == "Generated landscape"
