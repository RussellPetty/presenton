from api.middlewares import SessionAuthMiddleware


def test_only_shared_app_data_asset_prefixes_do_not_require_auth():
    middleware = SessionAuthMiddleware(app=None)

    assert middleware._requires_auth("/app_data/images/photo.png") is True
    assert middleware._requires_auth("/app_data/fonts/embedded/font.ttf") is False
    assert (
        middleware._requires_auth("/app_data/pptx-to-html/session/fonts/font.ttf")
        is True
    )
    assert (
        middleware._requires_auth("/app_data/templates/default/thumbnail.png") is False
    )
    assert (
        middleware._requires_auth("/app_data/pptx-to-html/session/images/image.png")
        is True
    )


def test_other_app_data_prefixes_still_require_auth():
    middleware = SessionAuthMiddleware(app=None)

    assert middleware._requires_auth("/app_data/uploads/source.pptx") is True
    assert middleware._requires_auth("/app_data/exports/deck.pdf") is True


def test_presenton_provider_endpoints_require_a_local_session():
    middleware = SessionAuthMiddleware(app=None)

    assert middleware._requires_auth("/api/v1/auth/presenton/status") is True
    assert middleware._requires_auth("/api/v1/auth/presenton/device/start") is True
    assert middleware._requires_auth("/api/v1/auth/presenton/device/poll") is True
