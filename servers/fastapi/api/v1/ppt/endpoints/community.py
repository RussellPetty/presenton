from typing import Any, Literal

from fastapi import APIRouter, Path, Query

from services.community_presentations import (
    get_community_presentation,
    list_community_presentations,
)


COMMUNITY_ROUTER = APIRouter(prefix="/community/presentations", tags=["Community"])


@COMMUNITY_ROUTER.get("")
async def list_presentations(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=8, ge=1, le=24),
    order_by: Literal["created_at", "views", "likes", "priority"] = "priority",
    order: Literal["asc", "desc"] = "desc",
) -> dict[str, Any]:
    return await list_community_presentations(
        page=page,
        page_size=page_size,
        order_by=order_by,
        order=order,
    )


@COMMUNITY_ROUTER.get("/{community_id}")
async def get_presentation(
    community_id: int = Path(ge=1),
) -> dict[str, Any]:
    return await get_community_presentation(community_id)
