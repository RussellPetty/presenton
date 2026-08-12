import asyncio

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from api.v1.auth import presenton_oauth
from api.v1.auth.config import SESSION_COOKIE_NAME
from api.v1.auth.router import API_V1_AUTH_ROUTER
from models.sql.presenton_oauth_identity import PresentonOAuthIdentity
from models.sql.user import User
from services.database import get_async_session


def _build_client(tmp_path) -> tuple[TestClient, object, object]:
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'oauth.db'}")
    session_maker = async_sessionmaker(engine, expire_on_commit=False)

    async def create_tables():
        async with engine.begin() as connection:
            await connection.run_sync(User.__table__.create)
            await connection.run_sync(PresentonOAuthIdentity.__table__.create)

    asyncio.run(create_tables())

    async def override_session():
        async with session_maker() as session:
            yield session

    app = FastAPI()
    app.include_router(API_V1_AUTH_ROUTER)
    app.dependency_overrides[get_async_session] = override_session
    return TestClient(app), engine, session_maker


def _response(status_code: int, payload: dict) -> httpx.Response:
    return httpx.Response(status_code, json=payload)


def test_presenton_login_uses_builtin_public_client_without_configuration(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("USER_CONFIG_PATH", str(tmp_path / "userConfig.json"))
    client, engine, _session_maker = _build_client(tmp_path)

    async def provider_request(_method, url, **kwargs):
        assert url.endswith("/oauth/device_authorization")
        assert kwargs["data"]["client_id"] == "ptc_presenton_open_source"
        return _response(
            200,
            {
                "device_code": "device-code-secret-12345",
                "user_code": "BCDF-GHJK",
                "verification_uri": "https://presenton.test/device",
                "verification_uri_complete": "https://presenton.test/device?user_code=BCDF-GHJK",
                "expires_in": 900,
                "interval": 5,
            },
        )

    monkeypatch.setattr(presenton_oauth, "_provider_request", provider_request)
    assert client.get("/api/v1/auth/presenton/status").json()["enabled"] is True
    response = client.post(
        "/api/v1/auth/presenton/device/start",
        json={"device_name": "Test device"},
    )
    assert response.status_code == 200
    asyncio.run(engine.dispose())


def test_presenton_device_login_creates_local_session_and_reuses_identity(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("USER_CONFIG_PATH", str(tmp_path / "userConfig.json"))
    client, engine, session_maker = _build_client(tmp_path)

    token_round = 0

    async def provider_request(method, url, **kwargs):
        nonlocal token_round
        if url.endswith("/oauth/device_authorization"):
            assert kwargs["data"]["scope"] == "presenton:api profile:read"
            return _response(
                200,
                {
                    "device_code": "device-code-secret-12345",
                    "user_code": "BCDF-GHJK",
                    "verification_uri": "https://presenton.test/device",
                    "verification_uri_complete": "https://presenton.test/device?user_code=BCDF-GHJK",
                    "expires_in": 900,
                    "interval": 5,
                },
            )
        if url.endswith("/oauth/token"):
            token_round += 1
            return _response(
                200,
                {
                    "access_token": f"pt_access_{token_round}",
                    "refresh_token": f"pt_refresh_{token_round}",
                    "token_type": "Bearer",
                    "scope": "presenton:api profile:read",
                    "expires_in": 3600,
                },
            )
        if url.endswith("/oauth/userinfo"):
            return _response(
                200,
                {
                    "sub": "hosted-user-123",
                    "email": "person@example.com",
                    "name": "Presenton User",
                },
            )
        if url.endswith("/oauth/revoke"):
            assert kwargs["data"]["token"].startswith("pt_refresh_")
            return _response(200, {})
        raise AssertionError(f"Unexpected provider URL: {method} {url}")

    monkeypatch.setattr(presenton_oauth, "_provider_request", provider_request)

    started = client.post(
        "/api/v1/auth/presenton/device/start",
        json={"device_name": "Test device"},
    )
    assert started.status_code == 200
    assert started.json()["user_code"] == "BCDF-GHJK"

    first_login = client.post(
        "/api/v1/auth/presenton/device/poll",
        json={"device_code": "device-code-secret-12345"},
    )
    assert first_login.status_code == 200
    assert first_login.json()["provider"] == "presenton"
    assert first_login.json()["username"] == "person@example.com"
    assert first_login.json()["role"] == "admin"
    assert SESSION_COOKIE_NAME in first_login.cookies
    assert "HttpOnly" in first_login.headers["set-cookie"]

    client.cookies.clear()
    second_login = client.post(
        "/api/v1/auth/presenton/device/poll",
        json={"device_code": "another-device-code-67890"},
    )
    assert second_login.status_code == 200
    assert second_login.json()["username"] == "person@example.com"

    async def counts():
        async with session_maker() as session:
            users = int(
                await session.scalar(select(func.count()).select_from(User)) or 0
            )
            identities = int(
                await session.scalar(
                    select(func.count()).select_from(PresentonOAuthIdentity)
                )
                or 0
            )
            identity = await session.scalar(select(PresentonOAuthIdentity))
            return users, identities, identity

    users, identities, identity = asyncio.run(counts())
    assert (users, identities) == (1, 1)
    assert identity.access_token_encrypted != "pt_access_2"
    assert identity.refresh_token_encrypted != "pt_refresh_2"
    assert identity.scopes == "presenton:api profile:read"
    asyncio.run(engine.dispose())


def test_presenton_device_login_reports_pending_authorization(monkeypatch, tmp_path):
    monkeypatch.setenv("USER_CONFIG_PATH", str(tmp_path / "userConfig.json"))
    client, engine, _session_maker = _build_client(tmp_path)

    async def provider_request(_method, url, **_kwargs):
        assert url.endswith("/oauth/token")
        return _response(
            400,
            {
                "error": "authorization_pending",
                "error_description": "Waiting for approval",
            },
        )

    monkeypatch.setattr(presenton_oauth, "_provider_request", provider_request)
    response = client.post(
        "/api/v1/auth/presenton/device/poll",
        json={"device_code": "device-code-secret-12345"},
    )

    assert response.status_code == 202
    assert response.json() == {
        "status": "pending",
        "error": "authorization_pending",
    }
    assert SESSION_COOKIE_NAME not in response.cookies
    asyncio.run(engine.dispose())


def test_onboarding_links_presenton_identity_to_existing_admin(monkeypatch, tmp_path):
    monkeypatch.setenv("USER_CONFIG_PATH", str(tmp_path / "userConfig.json"))
    client, engine, session_maker = _build_client(tmp_path)

    setup = client.post(
        "/api/v1/auth/setup",
        json={"username": "local-admin", "password": "secret123"},
    )
    assert setup.status_code == 200
    login = client.post(
        "/api/v1/auth/login",
        json={"username": "local-admin", "password": "secret123"},
    )
    assert login.status_code == 200

    async def provider_request(_method, url, **_kwargs):
        if url.endswith("/oauth/token"):
            return _response(
                200,
                {
                    "access_token": "pt_access_onboarding",
                    "refresh_token": "pt_refresh_onboarding",
                    "scope": "presenton:api profile:read",
                    "expires_in": 3600,
                },
            )
        if url.endswith("/oauth/userinfo"):
            return _response(
                200,
                {
                    "sub": "hosted-onboarding-user",
                    "email": "hosted@example.com",
                },
            )
        if url.endswith("/oauth/revoke"):
            return _response(200, {})
        raise AssertionError(f"Unexpected provider URL: {url}")

    monkeypatch.setattr(presenton_oauth, "_provider_request", provider_request)
    linked = client.post(
        "/api/v1/auth/presenton/device/poll",
        json={
            "device_code": "onboarding-device-code-12345",
            "link_current_user": True,
        },
    )

    assert linked.status_code == 200
    assert linked.json()["username"] == "local-admin"
    assert linked.json()["role"] == "admin"
    status = client.get("/api/v1/auth/presenton/status")
    assert status.status_code == 200
    assert status.json()["linked"] is True
    assert status.json()["cloud_generation_enabled"] is True
    assert status.json()["email"] == "hosted@example.com"

    logged_out = client.post("/api/v1/auth/presenton/logout")
    assert logged_out.status_code == 200
    assert logged_out.json() == {"detail": "Disconnected from Presenton successfully"}
    disconnected_status = client.get("/api/v1/auth/presenton/status")
    assert disconnected_status.status_code == 200
    assert disconnected_status.json()["linked"] is False
    assert disconnected_status.json()["email"] is None
    local_status = client.get("/api/v1/auth/status")
    assert local_status.json()["authenticated"] is True

    async def counts():
        async with session_maker() as session:
            users = int(
                await session.scalar(select(func.count()).select_from(User)) or 0
            )
            identities = int(
                await session.scalar(
                    select(func.count()).select_from(PresentonOAuthIdentity)
                )
                or 0
            )
            return users, identities

    assert asyncio.run(counts()) == (1, 0)
    asyncio.run(engine.dispose())
