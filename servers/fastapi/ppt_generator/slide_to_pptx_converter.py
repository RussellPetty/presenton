"""
Converts SlideModel to PptxPresentationModel without needing Puppeteer
"""
from typing import List
from ppt_generator.models.slide_model import SlideModel
from ppt_generator.models.pptx_models import (
    PptxPresentationModel,
    PptxSlideModel,
    PptxTextBoxModel,
    PptxPictureBoxModel,
    PptxAutoShapeBoxModel,
    PptxPositionModel,
    PptxFontModel,
    PptxParagraphModel,
    PptxTextRunModel,
    PptxFillModel,
    PptxStrokeModel,
    PptxShadowModel,
    PptxPictureModel,
    PptxObjectFitModel,
    PptxBoxShapeEnum,
    PptxObjectFitEnum,
)


# Theme colors for 'light' theme
THEME_COLORS = {
    "light": {
        "background": "FFFFFF",
        "title": "000000",
        "heading": "1F2937",
        "body": "374151",
        "box": "3B82F6",
    }
}


def convert_slides_to_pptx(slides: List[SlideModel], theme_name: str = "light") -> PptxPresentationModel:
    """Convert SlideModel list to PptxPresentationModel"""

    theme = THEME_COLORS.get(theme_name, THEME_COLORS["light"])
    pptx_slides = []

    for i, slide in enumerate(slides):
        slide_type = slide.type
        print(f"Converting slide {i+1}/{len(slides)}: type={slide_type}, content type={type(slide.content).__name__}")
        print(f"  Content.body type: {type(slide.content.body)}")

        if slide_type == 1:
            pptx_slide = convert_type1(slide, theme)
        elif slide_type in [2, 3, 4, 9]:
            # Types 2,3,4,9 all have List[HeadingModel] body, use type6 converter
            print(f"  Using type6 converter for type {slide_type}")
            pptx_slide = convert_type6(slide, theme)
        elif slide_type == 6:
            pptx_slide = convert_type6(slide, theme)
        elif slide_type == 7:
            pptx_slide = convert_type7(slide, theme)
        elif slide_type == 8:
            pptx_slide = convert_type8(slide, theme)
        else:
            # Default fallback
            print(f"  Unknown slide type {slide_type}, using type1 converter")
            pptx_slide = convert_type1(slide, theme)

        pptx_slides.append(pptx_slide)

    return PptxPresentationModel(
        background_color=theme["background"],
        slides=pptx_slides
    )


def convert_type1(slide: SlideModel, theme: dict) -> PptxSlideModel:
    """Type 1: Title + Body + Image"""
    shapes = []

    # Title
    shapes.append(PptxTextBoxModel(
        position=PptxPositionModel(left=80, top=80, width=560, height=80),
        paragraphs=[PptxParagraphModel(
            alignment=1,
            runs=[PptxTextRunModel(
                text=slide.content.title,
                font=PptxFontModel(name="Inter", size=44, bold=True, color=theme["title"])
            )]
        )]
    ))

    # Body
    shapes.append(PptxTextBoxModel(
        position=PptxPositionModel(left=80, top=200, width=560, height=400),
        paragraphs=[PptxParagraphModel(
            alignment=1,
            runs=[PptxTextRunModel(
                text=slide.content.body,
                font=PptxFontModel(name="Inter", size=18, bold=False, color=theme["body"])
            )]
        )]
    ))

    # Image (if exists)
    if slide.images and len(slide.images) > 0:
        shapes.append(PptxPictureBoxModel(
            position=PptxPositionModel(left=700, top=160, width=480, height=480),
            picture=PptxPictureModel(
                is_network=False,
                path=slide.images[0]
            ),
            shape=None,
            object_fit=PptxObjectFitModel(fit="cover", focus=[0.5, 0.5]),
            overlay=None,
            border_radius=[20, 20, 20, 20]
        ))

    return PptxSlideModel(shapes=shapes)


def convert_type6(slide: SlideModel, theme: dict) -> PptxSlideModel:
    """Type 6: Title + Description + 3 items with headings"""
    shapes = []

    # Title
    shapes.append(PptxTextBoxModel(
        position=PptxPositionModel(left=80, top=60, width=1120, height=70),
        paragraphs=[PptxParagraphModel(
            alignment=1,
            runs=[PptxTextRunModel(
                text=slide.content.title,
                font=PptxFontModel(name="Inter", size=40, bold=True, color=theme["title"])
            )]
        )]
    ))

    # Description (if exists - Types 6/8 have it, Types 2/3/4/9 don't)
    start_y = 240
    if hasattr(slide.content, 'description') and slide.content.description:
        shapes.append(PptxTextBoxModel(
            position=PptxPositionModel(left=80, top=150, width=1120, height=60),
            paragraphs=[PptxParagraphModel(
                alignment=1,
                runs=[PptxTextRunModel(
                    text=slide.content.description,
                    font=PptxFontModel(name="Inter", size=16, bold=False, color=theme["body"])
                )]
            )]
        ))
    else:
        start_y = 150

    # Items (3 columns)
    items = slide.content.body[:3]  # Max 3 items
    col_width = 340
    spacing = 40

    for idx, item in enumerate(items):
        x = 80 + (idx * (col_width + spacing))

        # Heading
        shapes.append(PptxTextBoxModel(
            position=PptxPositionModel(left=x, top=start_y, width=col_width, height=50),
            paragraphs=[PptxParagraphModel(
                alignment=1,
                runs=[PptxTextRunModel(
                    text=item.heading,
                    font=PptxFontModel(name="Inter", size=20, bold=True, color=theme["heading"])
                )]
            )]
        ))

        # Description
        shapes.append(PptxTextBoxModel(
            position=PptxPositionModel(left=x, top=start_y + 60, width=col_width, height=300),
            paragraphs=[PptxParagraphModel(
                alignment=1,
                runs=[PptxTextRunModel(
                    text=item.description,
                    font=PptxFontModel(name="Inter", size=14, bold=False, color=theme["body"])
                )]
            )]
        ))

    return PptxSlideModel(shapes=shapes)


def convert_type7(slide: SlideModel, theme: dict) -> PptxSlideModel:
    """Type 7: Title + 4 items with icons"""
    shapes = []

    # Title
    shapes.append(PptxTextBoxModel(
        position=PptxPositionModel(left=80, top=60, width=1120, height=70),
        paragraphs=[PptxParagraphModel(
            alignment=1,
            runs=[PptxTextRunModel(
                text=slide.content.title,
                font=PptxFontModel(name="Inter", size=40, bold=True, color=theme["title"])
            )]
        )]
    ))

    # Items (2x2 grid)
    items = slide.content.body[:4]  # Max 4 items
    icons = slide.icons[:4] if slide.icons else []

    positions = [
        (80, 200),    # Top left
        (660, 200),   # Top right
        (80, 440),    # Bottom left
        (660, 440),   # Bottom right
    ]

    box_width = 520
    box_height = 200

    for idx, item in enumerate(items):
        x, y = positions[idx]

        # Icon (if exists)
        if idx < len(icons):
            shapes.append(PptxPictureBoxModel(
                position=PptxPositionModel(left=x + 20, top=y + 20, width=60, height=60),
                picture=PptxPictureModel(
                    is_network=False,
                    path=icons[idx]
                ),
                shape=None,
                object_fit=PptxObjectFitModel(fit="contain", focus=[0.5, 0.5]),
                overlay="FFFFFF",
                border_radius=[0, 0, 0, 0]
            ))

        # Heading
        shapes.append(PptxTextBoxModel(
            position=PptxPositionModel(left=x + 100, top=y + 30, width=400, height=40),
            paragraphs=[PptxParagraphModel(
                alignment=1,
                runs=[PptxTextRunModel(
                    text=item.heading,
                    font=PptxFontModel(name="Inter", size=18, bold=True, color=theme["heading"])
                )]
            )]
        ))

        # Description
        shapes.append(PptxTextBoxModel(
            position=PptxPositionModel(left=x + 100, top=y + 80, width=400, height=100),
            paragraphs=[PptxParagraphModel(
                alignment=1,
                runs=[PptxTextRunModel(
                    text=item.description,
                    font=PptxFontModel(name="Inter", size=14, bold=False, color=theme["body"])
                )]
            )]
        ))

    return PptxSlideModel(shapes=shapes)


def convert_type8(slide: SlideModel, theme: dict) -> PptxSlideModel:
    """Type 8: Title + Description + items with icons"""
    shapes = []

    # Title
    shapes.append(PptxTextBoxModel(
        position=PptxPositionModel(left=80, top=60, width=1120, height=70),
        paragraphs=[PptxParagraphModel(
            alignment=1,
            runs=[PptxTextRunModel(
                text=slide.content.title,
                font=PptxFontModel(name="Inter", size=40, bold=True, color=theme["title"])
            )]
        )]
    ))

    # Description
    shapes.append(PptxTextBoxModel(
        position=PptxPositionModel(left=80, top=150, width=1120, height=60),
        paragraphs=[PptxParagraphModel(
            alignment=1,
            runs=[PptxTextRunModel(
                text=slide.content.description,
                font=PptxFontModel(name="Inter", size=16, bold=False, color=theme["body"])
            )]
        )]
    ))

    # Items (2x2 grid)
    items = slide.content.body[:4]  # Max 4 items
    icons = slide.icons[:4] if slide.icons else []

    positions = [
        (80, 240),    # Top left
        (660, 240),   # Top right
        (80, 460),    # Bottom left
        (660, 460),   # Bottom right
    ]

    for idx, item in enumerate(items):
        x, y = positions[idx]

        # Icon (if exists)
        if idx < len(icons):
            shapes.append(PptxPictureBoxModel(
                position=PptxPositionModel(left=x + 20, top=y + 20, width=50, height=50),
                picture=PptxPictureModel(
                    is_network=False,
                    path=icons[idx]
                ),
                shape=None,
                object_fit=PptxObjectFitModel(fit="contain", focus=[0.5, 0.5]),
                overlay="FFFFFF",
                border_radius=[0, 0, 0, 0]
            ))

        # Heading
        shapes.append(PptxTextBoxModel(
            position=PptxPositionModel(left=x + 90, top=y + 25, width=410, height=35),
            paragraphs=[PptxParagraphModel(
                alignment=1,
                runs=[PptxTextRunModel(
                    text=item.heading,
                    font=PptxFontModel(name="Inter", size=16, bold=True, color=theme["heading"])
                )]
            )]
        ))

        # Description
        shapes.append(PptxTextBoxModel(
            position=PptxPositionModel(left=x + 90, top=y + 65, width=410, height=90),
            paragraphs=[PptxParagraphModel(
                alignment=1,
                runs=[PptxTextRunModel(
                    text=item.description,
                    font=PptxFontModel(name="Inter", size=13, bold=False, color=theme["body"])
                )]
            )]
        ))

    return PptxSlideModel(shapes=shapes)
