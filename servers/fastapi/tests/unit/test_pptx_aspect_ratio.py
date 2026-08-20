from pathlib import Path
import os
import stat
import xml.etree.ElementTree as ET
from zipfile import ZipFile

import pytest

from utils.pptx_aspect_ratio import resize_pptx_aspect_ratio


P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"


PRESENTATION_XML = f"""<?xml version="1.0" encoding="UTF-8"?>
<p:presentation xmlns:p="{P_NS}">
  <p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>
</p:presentation>
"""

SHAPES_XML = f"""<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="{P_NS}" xmlns:a="{A_NS}">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr/><p:grpSpPr/>
    <p:sp><p:spPr><a:xfrm><a:off x="10" y="100"/></a:xfrm></p:spPr></p:sp>
    <p:pic><p:spPr><a:xfrm><a:off x="20" y="200"/></a:xfrm></p:spPr></p:pic>
    <p:graphicFrame><p:xfrm><a:off x="30" y="300"/></p:xfrm></p:graphicFrame>
    <p:grpSp>
      <p:grpSpPr><a:xfrm><a:off x="40" y="400"/></a:xfrm></p:grpSpPr>
      <p:sp><p:spPr><a:xfrm><a:off x="50" y="500"/></a:xfrm></p:spPr></p:sp>
    </p:grpSp>
  </p:spTree></p:cSld>
</p:sld>
"""


def _make_pptx(path: Path) -> None:
    with ZipFile(path, "w") as archive:
        archive.writestr("ppt/presentation.xml", PRESENTATION_XML)
        archive.writestr("ppt/slides/slide1.xml", SHAPES_XML)
        archive.writestr("ppt/slideLayouts/slideLayout1.xml", SHAPES_XML)
        archive.writestr("ppt/slideMasters/slideMaster1.xml", SHAPES_XML)
        archive.writestr("docProps/core.xml", b"preserved")


def _read_slide_size(path: Path) -> tuple[int, int, str]:
    with ZipFile(path) as archive:
        root = ET.fromstring(archive.read("ppt/presentation.xml"))
    size = root.find(f"{{{P_NS}}}sldSz")
    assert size is not None
    return int(size.get("cx")), int(size.get("cy")), size.get("type")


def _read_shape_offsets(path: Path, part: str) -> list[int]:
    with ZipFile(path) as archive:
        root = ET.fromstring(archive.read(part))
    tree = root.find(f".//{{{P_NS}}}spTree")
    assert tree is not None
    paths = [
        f"{{{P_NS}}}spPr/{{{A_NS}}}xfrm/{{{A_NS}}}off",
        f"{{{P_NS}}}spPr/{{{A_NS}}}xfrm/{{{A_NS}}}off",
        f"{{{P_NS}}}xfrm/{{{A_NS}}}off",
        f"{{{P_NS}}}grpSpPr/{{{A_NS}}}xfrm/{{{A_NS}}}off",
    ]
    shapes = list(tree)[2:]
    offsets = []
    for shape, transform_path in zip(shapes, paths):
        offset = shape.find(transform_path)
        assert offset is not None
        offsets.append(int(offset.get("y")))

    nested_offset = shapes[-1].find(
        f"{{{P_NS}}}sp/{{{P_NS}}}spPr/{{{A_NS}}}xfrm/{{{A_NS}}}off"
    )
    assert nested_offset is not None
    offsets.append(int(nested_offset.get("y")))
    return offsets


@pytest.mark.parametrize(
    ("aspect_ratio", "expected_height", "expected_type", "expected_shift"),
    [
        ("16:9", 6858000, "screen16x9", 0),
        ("4:3", 9144000, "screen4x3", 1143000),
        ("1:1", 12192000, "custom", 2667000),
    ],
)
def test_resize_pptx_canvas_and_center_shapes(
    tmp_path,
    aspect_ratio,
    expected_height,
    expected_type,
    expected_shift,
):
    pptx_path = tmp_path / "deck.pptx"
    _make_pptx(pptx_path)

    result = resize_pptx_aspect_ratio(pptx_path, aspect_ratio)

    assert result == pptx_path
    assert _read_slide_size(pptx_path) == (
        12192000,
        expected_height,
        expected_type,
    )
    expected_offsets = [
        100 + expected_shift,
        200 + expected_shift,
        300 + expected_shift,
        400 + expected_shift,
        500,
    ]
    for part in (
        "ppt/slides/slide1.xml",
        "ppt/slideLayouts/slideLayout1.xml",
        "ppt/slideMasters/slideMaster1.xml",
    ):
        assert _read_shape_offsets(pptx_path, part) == expected_offsets
    with ZipFile(pptx_path) as archive:
        assert archive.read("docProps/core.xml") == b"preserved"


def test_resize_is_idempotent_and_reversible(tmp_path):
    pptx_path = tmp_path / "deck.pptx"
    _make_pptx(pptx_path)
    os.chmod(pptx_path, 0o644)

    resize_pptx_aspect_ratio(pptx_path, "4:3")
    assert stat.S_IMODE(pptx_path.stat().st_mode) == 0o644
    first_offsets = _read_shape_offsets(pptx_path, "ppt/slides/slide1.xml")
    resize_pptx_aspect_ratio(pptx_path, "4:3")
    assert _read_shape_offsets(pptx_path, "ppt/slides/slide1.xml") == first_offsets

    resize_pptx_aspect_ratio(pptx_path, "1:1")
    assert _read_shape_offsets(pptx_path, "ppt/slides/slide1.xml") == [
        2667100,
        2667200,
        2667300,
        2667400,
        500,
    ]

    resize_pptx_aspect_ratio(pptx_path, "16:9")
    assert _read_slide_size(pptx_path) == (12192000, 6858000, "screen16x9")
    assert _read_shape_offsets(pptx_path, "ppt/slides/slide1.xml") == [
        100,
        200,
        300,
        400,
        500,
    ]


def test_resize_rejects_unsupported_ratio(tmp_path):
    pptx_path = tmp_path / "deck.pptx"
    _make_pptx(pptx_path)

    with pytest.raises(ValueError, match="Unsupported"):
        resize_pptx_aspect_ratio(pptx_path, "3:2")
