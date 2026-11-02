import asyncio

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel, select

from models.sql.key_value import KeyValueSqlModel
from models.sql.presentation import PresentationModel
from utils.brand_theme import apply_brand_theme, brand_theme_application_result


@pytest.mark.parametrize("logo", [None, "", "https://brand.example/logo.png"])
def test_application_reports_the_assets_persisted_on_the_deck(logo):
    async def run():
        engine = create_async_engine("sqlite+aiosqlite://")
        async with engine.begin() as connection:
            await connection.run_sync(
                lambda sync: SQLModel.metadata.create_all(
                    sync,
                    tables=[PresentationModel.__table__, KeyValueSqlModel.__table__],
                )
            )
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            deck = PresentationModel(
                user_id="owner", content="Buying a home", n_slides=7, language="English"
            )
            session.add(deck)
            await session.commit()
            theme = await apply_brand_theme(
                sql_session=session,
                user_id="owner",
                presentation=deck,
                branding={
                    "primaryColor": "#7e56c2",
                    "companyName": "Broker Marketplace",
                    "logoUrl": logo,
                },
            )
            result = brand_theme_application_result(theme)
            await session.refresh(deck)
            assert deck.theme["logo_url"] == (logo or None)
            assert result["logo_applied"] == bool(deck.theme["logo_url"])
            assert result["company_name_applied"] is True
            assert result["applied"] is True
            if logo:
                assert "logo" in result["message"]
                assert "no logo was added" not in result["message"]
            else:
                assert "no logo was added" in result["message"]
                assert "profile settings" in result["message"]
            saved = await session.scalar(
                select(KeyValueSqlModel).where(
                    KeyValueSqlModel.key == "presentation_custom_themes::owner"
                )
            )
            assert saved.value["themes"][0] == deck.theme
        await engine.dispose()

    asyncio.run(run())


def test_application_does_not_claim_a_missing_company_name():
    result = brand_theme_application_result({"name": "Brand", "logo_url": "/logo.png"})
    assert result["logo_applied"] is True
    assert result["company_name_applied"] is False
    assert "company name" not in result["message"]
