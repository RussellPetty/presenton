"""Per-user data scoping for multi-tenant isolation.

Every user-data request derives its owner from ``request.state.external_user_id``
(set by SessionAuthMiddleware in Clerk mode). When auth is disabled (local dev /
Electron) the owner falls back to ``LOCAL_USER_ID``. The :class:`Scope` object
bundles the DB session with that user id and provides helpers that filter/verify
ownership, so a forgotten ``where`` clause can't leak another user's data.

Usage in an endpoint::

    @router.get("/all")
    async def list_items(scope: Scope = Depends(get_scope)):
        result = await scope.session.execute(scope.owned(select(Item), Item))
        ...

    @router.get("/{item_id}")
    async def get_item(item_id: UUID, scope: Scope = Depends(get_scope)):
        item = await scope.get_owned(Item, item_id)   # 404 if missing or not owned
"""

from typing import Any

from fastapi import Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from services.database import get_async_session
from utils.get_env import is_disable_auth_enabled

# Synthetic owner used when auth is disabled. Matches the migration backfill
# sentinel; real (Clerk) deployments always have a verified external_user_id.
LOCAL_USER_ID = "local"


def get_current_user_id(request: Request) -> str:
    """Verified owner for this request, or LOCAL_USER_ID when auth is disabled."""
    user_id = getattr(request.state, "external_user_id", None)
    if isinstance(user_id, str) and user_id:
        return user_id
    if is_disable_auth_enabled():
        return LOCAL_USER_ID
    raise HTTPException(status_code=401, detail="Unauthorized")


class Scope:
    """Bundles the request DB session with its owner user id + scoping helpers."""

    def __init__(self, session: AsyncSession, user_id: str):
        self.session = session
        self.user_id = user_id

    def owned(self, statement, model):
        """Append ``model.user_id == <current user>`` to a select/update/delete."""
        return statement.where(model.user_id == self.user_id)

    async def get_owned(self, model: Any, primary_key: Any):
        """Fetch by primary key, returning it only if owned by the current user.

        Raises 404 (not 403) on a missing OR foreign row so row existence is not
        leaked across tenants."""
        obj = await self.session.get(model, primary_key)
        if obj is None or getattr(obj, "user_id", None) != self.user_id:
            raise HTTPException(status_code=404, detail=f"{model.__name__} not found")
        return obj


async def get_scope(
    request: Request,
    session: AsyncSession = Depends(get_async_session),
) -> Scope:
    return Scope(session, get_current_user_id(request))
