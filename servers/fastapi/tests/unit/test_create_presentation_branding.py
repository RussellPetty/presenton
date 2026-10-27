import asyncio

from api.v1.ppt.endpoints.presentation import create_presentation
from enums.tone import Tone
from enums.verbosity import Verbosity
from models.sql.key_value import KeyValueSqlModel
from models.sql.presentation import PresentationModel
from tests.conftest import FakeAsyncSession
from utils.brand_theme import build_presenter_instructions
from utils.request_scope import Scope

BRANDING = {
    "primaryColor": "#202d71",
    "secondaryColor": "#ef8903",
    "logoUrl": "https://example.supabase.co/storage/v1/object/public/userData/u/logo.png",
    "companyName": "MortgageLink Solutions, LLC",
    "fullName": "Jane Doe",
    "title": "Senior Loan Officer",
    "nmls": "254245",
}


class BrandingSession(FakeAsyncSession):
    async def scalar(self, *_args, **_kwargs):
        return None  # no saved themes yet

    async def rollback(self) -> None:
        return None


def _create(branding=None, instructions=None):
    session = BrandingSession()
    presentation = asyncio.run(
        create_presentation(
            content="Loan options for first-time buyers",
            n_slides=8,
            language="English",
            file_paths=None,
            tone=Tone.DEFAULT,
            verbosity=Verbosity.STANDARD,
            instructions=instructions,
            include_table_of_contents=False,
            include_title_slide=True,
            web_search=False,
            branding=branding,
            scope=Scope(session, "user_test"),
        )
    )
    return presentation, session


def test_create_with_branding_persists_brand_theme():
    presentation, session = _create(BRANDING)

    assert presentation.theme["name"] == "Brand"
    assert presentation.theme["company_name"] == "MortgageLink Solutions, LLC"
    assert presentation.theme["logo_url"] == BRANDING["logoUrl"]
    assert presentation.theme["data"]["colors"]
    stored = [obj for obj in session.added if isinstance(obj, KeyValueSqlModel)]
    assert stored and stored[0].key == "presentation_custom_themes::user_test"


def test_create_with_branding_adds_presenter_details_after_user_instructions():
    presentation, _ = _create(BRANDING, instructions="Keep it short.")

    assert presentation.instructions.startswith("Keep it short.\n\n")
    assert "Name: Jane Doe" in presentation.instructions
    assert "NMLS #: 254245" in presentation.instructions


def test_create_without_branding_is_unchanged():
    presentation, session = _create(None, instructions="Keep it short.")

    assert presentation.theme is None
    assert presentation.instructions == "Keep it short."
    assert not any(isinstance(obj, KeyValueSqlModel) for obj in session.added)
    assert isinstance(presentation, PresentationModel)


def test_presenter_instructions_need_name_or_company():
    assert build_presenter_instructions({"primaryColor": "#202d71"}) is None
    assert build_presenter_instructions(None) is None
