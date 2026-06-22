from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from models.theme_data import ThemeData
from utils.theme_utils import build_theme_data_from_palette, generate_color_palette

THEME_ROUTER = APIRouter(prefix="/theme", tags=["V3 Theme"])


class GenerateThemeRequestV3(BaseModel):
    primary: Optional[str] = None
    background: Optional[str] = None
    accent_1: Optional[str] = None
    accent_2: Optional[str] = None
    text_1: Optional[str] = None
    text_2: Optional[str] = None


@THEME_ROUTER.post("/generate", response_model=ThemeData)
async def generate_theme_v3(request: GenerateThemeRequestV3) -> ThemeData:
    color_palette = generate_color_palette(
        request.primary,
        request.background,
        request.accent_1,
        request.accent_2,
        request.text_1,
        request.text_2,
    )
    return build_theme_data_from_palette(color_palette)
