"""Two-user isolation tests for the Scope helper against a real SQLite DB.

These prove the core multi-tenant guarantees that every router relies on:
- ``scope.owned(select, Model)`` returns only the caller's rows.
- ``scope.get_owned(Model, pk)`` raises 404 for a foreign/missing row and
  returns the row for its owner.
- stamping ``user_id`` on create partitions rows by user.

Uses ``asyncio.run`` so no pytest-asyncio dependency is required."""

import asyncio

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel, select

from models.sql.image_asset import ImageAsset
from models.sql.presentation import PresentationModel
from utils.request_scope import LOCAL_USER_ID, Scope, get_current_user_id


def _run(coro):
    return asyncio.run(coro)


async def _fresh_session():
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    return engine, maker


def _new_presentation(user_id: str, content: str) -> PresentationModel:
    return PresentationModel(user_id=user_id, content=content, n_slides=1, language="en")


def test_owned_select_returns_only_callers_rows():
    async def scenario():
        engine, maker = await _fresh_session()
        async with maker() as s:
            s.add(_new_presentation("user-A", "a1"))
            s.add(_new_presentation("user-A", "a2"))
            s.add(_new_presentation("user-B", "b1"))
            await s.commit()

            a_rows = (
                await s.execute(
                    Scope(s, "user-A").owned(select(PresentationModel), PresentationModel)
                )
            ).scalars().all()
            b_rows = (
                await s.execute(
                    Scope(s, "user-B").owned(select(PresentationModel), PresentationModel)
                )
            ).scalars().all()

            assert {r.content for r in a_rows} == {"a1", "a2"}
            assert {r.content for r in b_rows} == {"b1"}
        await engine.dispose()

    _run(scenario())


def test_get_owned_blocks_foreign_and_allows_owner():
    async def scenario():
        engine, maker = await _fresh_session()
        async with maker() as s:
            p = _new_presentation("user-A", "a1")
            s.add(p)
            await s.commit()
            pid = p.id

            # Foreign user -> 404
            with pytest.raises(HTTPException) as exc:
                await Scope(s, "user-B").get_owned(PresentationModel, pid)
            assert exc.value.status_code == 404

            # Owner -> returns the row
            got = await Scope(s, "user-A").get_owned(PresentationModel, pid)
            assert got.id == pid
        await engine.dispose()

    _run(scenario())


def test_get_owned_missing_row_is_404():
    async def scenario():
        engine, maker = await _fresh_session()
        async with maker() as s:
            import uuid

            with pytest.raises(HTTPException) as exc:
                await Scope(s, "user-A").get_owned(PresentationModel, uuid.uuid4())
            assert exc.value.status_code == 404
        await engine.dispose()

    _run(scenario())


def test_image_assets_partition_by_user():
    async def scenario():
        engine, maker = await _fresh_session()
        async with maker() as s:
            s.add(ImageAsset(user_id="user-A", is_uploaded=True, path="/a.png"))
            s.add(ImageAsset(user_id="user-B", is_uploaded=True, path="/b.png"))
            await s.commit()

            a_imgs = (
                await s.execute(Scope(s, "user-A").owned(select(ImageAsset), ImageAsset))
            ).scalars().all()
            assert [i.path for i in a_imgs] == ["/a.png"]
        await engine.dispose()

    _run(scenario())


def test_get_current_user_id_local_fallback(monkeypatch):
    class _Req:
        class state:  # noqa: N801 - mimic request.state with no external_user_id
            pass

    # Auth disabled -> LOCAL_USER_ID
    monkeypatch.setenv("DISABLE_AUTH", "true")
    assert get_current_user_id(_Req()) == LOCAL_USER_ID

    # Auth enabled + no identity -> 401
    monkeypatch.setenv("DISABLE_AUTH", "false")
    with pytest.raises(HTTPException) as exc:
        get_current_user_id(_Req())
    assert exc.value.status_code == 401
