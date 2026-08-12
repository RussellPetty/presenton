import asyncio
from datetime import timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from models.sql.presenton_oauth_identity import PresentonOAuthIdentity
from models.sql.user import User
from services import presenton_cloud
from utils.datetime_utils import get_current_utc_datetime


def test_presenton_tokens_are_encrypted_refreshed_and_used_server_side(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("USER_CONFIG_PATH", str(tmp_path / "userConfig.json"))
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'cloud.db'}")
    session_maker = async_sessionmaker(engine, expire_on_commit=False)
    requests: list[tuple[str, str, dict]] = []

    class FakeAsyncClient:
        def __init__(self, **_kwargs):
            self.closed = False

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, url, **kwargs):
            requests.append(("POST", url, kwargs))
            assert url.endswith("/oauth/token")
            assert kwargs["data"]["refresh_token"] == "pt_refresh_original"
            return httpx.Response(
                200,
                json={
                    "access_token": "pt_access_rotated",
                    "refresh_token": "pt_refresh_rotated",
                    "scope": "presenton:api profile:read",
                    "expires_in": 3600,
                },
            )

        def build_request(self, method, url, **kwargs):
            return httpx.Request(method, url, **kwargs)

        async def send(self, request, *, stream):
            requests.append(
                (
                    request.method,
                    str(request.url),
                    {
                        "headers": request.headers,
                        "content": request.content,
                        "stream": stream,
                    },
                )
            )
            assert request.headers["Authorization"] == "Bearer pt_access_rotated"
            return httpx.Response(
                200,
                json={"presentation_id": "cloud-id"},
                request=request,
            )

        async def aclose(self):
            self.closed = True

    monkeypatch.setattr(presenton_cloud.httpx, "AsyncClient", FakeAsyncClient)

    async def run():
        async with engine.begin() as connection:
            await connection.run_sync(User.__table__.create)
            await connection.run_sync(PresentonOAuthIdentity.__table__.create)

        async with session_maker() as session:
            user = User(
                username="local-admin",
                hashed_password="not-used",
                is_active=True,
                is_verified=True,
                is_superuser=True,
                auth_version=1,
            )
            session.add(user)
            await session.flush()
            identity = PresentonOAuthIdentity(
                user_id=user.id,
                issuer="https://accounts.presenton.test",
                subject="cloud-user",
                email="cloud@example.com",
            )
            session.add(identity)
            await session.commit()
            await presenton_cloud.store_presenton_credentials(
                session,
                user_id=user.id,
                issuer=identity.issuer,
                access_token="pt_access_original",
                refresh_token="pt_refresh_original",
                scope="profile:read presenton:api",
                expires_in=3600,
            )

            stored = await session.scalar(select(PresentonOAuthIdentity))
            assert stored.access_token_encrypted != "pt_access_original"
            assert stored.refresh_token_encrypted != "pt_refresh_original"
            stored.token_expires_at = get_current_utc_datetime() - timedelta(seconds=1)
            session.add(stored)
            await session.commit()

            client, response = await presenton_cloud.open_presenton_cloud_response(
                session,
                user_id=user.id,
                issuer=identity.issuer,
                method="POST",
                path="/api/v1/ppt/presentation/create",
                query_string="mode=smart",
                headers={"Content-Type": "application/json"},
                content=b'{"content":"Test cloud generation"}',
            )
            assert response.status_code == 200
            assert await response.aread() == b'{"presentation_id":"cloud-id"}'
            await response.aclose()
            await client.aclose()

            refreshed = await session.scalar(select(PresentonOAuthIdentity))
            assert refreshed.access_token_encrypted != "pt_access_rotated"
            assert refreshed.refresh_token_encrypted != "pt_refresh_rotated"
            assert (
                presenton_cloud._decrypt_token(refreshed.refresh_token_encrypted)
                == "pt_refresh_rotated"
            )

        await engine.dispose()

    asyncio.run(run())
    assert [request[1] for request in requests] == [
        "https://accounts.presenton.test/oauth/token",
        "https://accounts.presenton.test/api/v1/ppt/presentation/create?mode=smart",
    ]
    assert requests[1][2]["content"] == b'{"content":"Test cloud generation"}'
    assert requests[1][2]["stream"] is True
