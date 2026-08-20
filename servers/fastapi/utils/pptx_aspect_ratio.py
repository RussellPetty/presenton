"""Resize a generated PPTX canvas while preserving its editable slide content."""

from __future__ import annotations

import os
from pathlib import Path
import re
import stat
import tempfile
from typing import Literal
import xml.etree.ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile


PresentationAspectRatio = Literal["16:9", "4:3", "1:1"]

PRESENTATION_XML = "ppt/presentation.xml"
PRESENTATION_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
RESIZABLE_PART_RE = re.compile(
    r"^ppt/(?:slides/slide\d+|slideLayouts/slideLayout\d+|"
    r"slideMasters/slideMaster\d+)\.xml$"
)
RATIO_HEIGHTS = {
    "16:9": lambda width: round(width * 9 / 16),
    "4:3": lambda width: round(width * 3 / 4),
    "1:1": lambda width: width,
}
SLIDE_SIZE_TYPES: dict[PresentationAspectRatio, str] = {
    "16:9": "screen16x9",
    "4:3": "screen4x3",
    "1:1": "custom",
}

ET.register_namespace("a", DRAWING_NS)
ET.register_namespace("p", PRESENTATION_NS)


def _qname(namespace: str, local_name: str) -> str:
    return f"{{{namespace}}}{local_name}"


def _shift_top_level_shapes(xml_data: bytes, delta_y: int) -> bytes:
    if delta_y == 0:
        return xml_data

    root = ET.fromstring(xml_data)
    sp_tree = root.find(f".//{_qname(PRESENTATION_NS, 'spTree')}")
    if sp_tree is None:
        return xml_data

    transform_paths = {
        _qname(PRESENTATION_NS, "sp"): (
            _qname(PRESENTATION_NS, "spPr"),
            _qname(DRAWING_NS, "xfrm"),
            _qname(DRAWING_NS, "off"),
        ),
        _qname(PRESENTATION_NS, "pic"): (
            _qname(PRESENTATION_NS, "spPr"),
            _qname(DRAWING_NS, "xfrm"),
            _qname(DRAWING_NS, "off"),
        ),
        _qname(PRESENTATION_NS, "cxnSp"): (
            _qname(PRESENTATION_NS, "spPr"),
            _qname(DRAWING_NS, "xfrm"),
            _qname(DRAWING_NS, "off"),
        ),
        _qname(PRESENTATION_NS, "graphicFrame"): (
            _qname(PRESENTATION_NS, "xfrm"),
            _qname(DRAWING_NS, "off"),
        ),
        _qname(PRESENTATION_NS, "grpSp"): (
            _qname(PRESENTATION_NS, "grpSpPr"),
            _qname(DRAWING_NS, "xfrm"),
            _qname(DRAWING_NS, "off"),
        ),
    }

    changed = False
    for shape in list(sp_tree):
        path = transform_paths.get(shape.tag)
        if path is None:
            continue
        offset = shape.find("/".join(path))
        if offset is None or "y" not in offset.attrib:
            continue
        offset.set("y", str(int(offset.get("y", "0")) + delta_y))
        changed = True

    if not changed:
        return xml_data
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _resize_presentation_xml(
    xml_data: bytes, aspect_ratio: PresentationAspectRatio
) -> tuple[bytes, int]:
    root = ET.fromstring(xml_data)
    slide_size = root.find(_qname(PRESENTATION_NS, "sldSz"))
    if slide_size is None:
        raise ValueError("PPTX presentation.xml does not contain p:sldSz")

    width = int(slide_size.get("cx", "0"))
    current_height = int(slide_size.get("cy", "0"))
    if width <= 0 or current_height <= 0:
        raise ValueError("PPTX contains invalid slide dimensions")

    target_height = RATIO_HEIGHTS[aspect_ratio](width)
    delta_y = round((target_height - current_height) / 2)
    slide_size.set("cy", str(target_height))
    slide_size.set("type", SLIDE_SIZE_TYPES[aspect_ratio])
    return (
        ET.tostring(root, encoding="utf-8", xml_declaration=True),
        delta_y,
    )


def resize_pptx_aspect_ratio(
    pptx_path: str | os.PathLike[str], aspect_ratio: PresentationAspectRatio
) -> Path:
    """Resize ``pptx_path`` in place and vertically center all top-level shapes.

    Shape sizes are left untouched, so text, images, and editable elements do not
    stretch. Converting between supported ratios is reversible and calling the
    function repeatedly with the same ratio is idempotent.
    """

    if aspect_ratio not in RATIO_HEIGHTS:
        raise ValueError(f"Unsupported presentation aspect ratio: {aspect_ratio}")

    path = Path(pptx_path).resolve()
    if path.suffix.lower() != ".pptx" or not path.is_file():
        raise ValueError(f"PPTX file does not exist: {path}")
    original_mode = stat.S_IMODE(path.stat().st_mode)

    temp_file = tempfile.NamedTemporaryFile(
        prefix=f".{path.stem}-ratio-",
        suffix=".pptx",
        dir=path.parent,
        delete=False,
    )
    temp_path = Path(temp_file.name)
    temp_file.close()

    try:
        with ZipFile(path, "r") as source:
            try:
                presentation_xml = source.read(PRESENTATION_XML)
            except KeyError as exc:
                raise ValueError("File is not a valid PPTX presentation") from exc

            resized_presentation_xml, delta_y = _resize_presentation_xml(
                presentation_xml, aspect_ratio
            )

            with ZipFile(temp_path, "w", compression=ZIP_DEFLATED) as target:
                for entry in source.infolist():
                    data = source.read(entry.filename)
                    if entry.filename == PRESENTATION_XML:
                        data = resized_presentation_xml
                    elif RESIZABLE_PART_RE.match(entry.filename):
                        data = _shift_top_level_shapes(data, delta_y)
                    target.writestr(entry, data)

        os.replace(temp_path, path)
        os.chmod(path, original_mode)
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise

    return path
