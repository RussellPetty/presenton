import asyncio

from services import object_storage


class _Response:
    def raise_for_status(self):
        return None

    def json(self):
        return {
            "signedURL": (
                "/object/sign/presenton/user/images/Tammy Headshot.png"
                "?token=header.payload%2Bsignature"
            )
        }


class _Client:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def post(self, *args, **kwargs):
        return _Response()


def test_create_signed_url_encodes_path_spaces_without_changing_token(monkeypatch):
    monkeypatch.setattr(
        object_storage,
        "_config",
        lambda: ("https://project.supabase.co", "service-key", "presenton"),
    )
    monkeypatch.setattr(object_storage.httpx, "AsyncClient", _Client)

    result = asyncio.run(object_storage.create_signed_url("user/images/headshot.png"))

    assert result == (
        "https://project.supabase.co/storage/v1/object/sign/presenton/"
        "user/images/Tammy%20Headshot.png?token=header.payload%2Bsignature"
    )
