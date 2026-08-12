import asyncio
from datetime import timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from models.sql.presenton_cloud_provider import PresentonCloudProvider
from models.sql.presenton_oauth_identity import PresentonOAuthIdentity
from models.sql.user import User
from services import presenton_cloud
from utils.datetime_utils import get_current_utc_datetime


def test_presenton_jwt_is_encrypted_and_used_server_side(monkeypatch, tmp_path):
    monkeypatch.setenv("USER_CONFIG_PATH", str(tmp_path / "userConfig.json"))
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'cloud.db'}")
    session_maker = async_sessionmaker(engine, expire_on_commit=False)
    requests: list[tuple[str, str, dict]] = []

    class FakeAsyncClient:
        def __init__(self, **_kwargs):
            self.closed = False

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
            assert request.headers["Authorization"] == "Bearer user.jwt.signature"
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
            await connection.run_sync(PresentonCloudProvider.__table__.create)

        async with session_maker() as session:
            await presenton_cloud.store_presenton_credentials(
                session,
                issuer="https://accounts.presenton.test",
                subject="cloud-user",
                email="cloud@example.com",
                access_token="user.jwt.signature",
                expires_in=3600,
            )

            stored = await session.scalar(select(PresentonCloudProvider))
            assert stored.subject == "cloud-user"
            assert stored.email == "cloud@example.com"
            assert stored.access_token_encrypted != "user.jwt.signature"
            assert stored.refresh_token_encrypted is None
            assert stored.scopes is None

            client, response = await presenton_cloud.open_presenton_cloud_response(
                session,
                issuer="https://accounts.presenton.test",
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

        await engine.dispose()

    asyncio.run(run())
    assert [request[1] for request in requests] == [
        "https://accounts.presenton.test/api/v1/ppt/presentation/create?mode=smart",
    ]
    assert requests[0][2]["content"] == b'{"content":"Test cloud generation"}'
    assert requests[0][2]["stream"] is True


def test_legacy_admin_credentials_are_migrated_to_the_global_provider(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("USER_CONFIG_PATH", str(tmp_path / "userConfig.json"))
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'migration.db'}")
    session_maker = async_sessionmaker(engine, expire_on_commit=False)

    async def run():
        async with engine.begin() as connection:
            await connection.run_sync(User.__table__.create)
            await connection.run_sync(PresentonOAuthIdentity.__table__.create)
            await connection.run_sync(PresentonCloudProvider.__table__.create)

        async with session_maker() as session:
            admin = User(
                username="admin",
                hashed_password="not-used",
                is_active=True,
                is_verified=True,
                is_superuser=True,
                admin_slot="primary",
                auth_version=1,
            )
            member = User(
                username="member",
                hashed_password="not-used",
                is_active=True,
                is_verified=True,
                is_superuser=False,
                auth_version=1,
            )
            session.add_all([admin, member])
            await session.flush()
            session.add_all(
                [
                    PresentonOAuthIdentity(
                        user_id=admin.id,
                        issuer="https://accounts.presenton.test",
                        subject="admin-cloud-user",
                        email="admin@example.com",
                        access_token_encrypted=presenton_cloud._encrypt_token(
                            "admin-access"
                        ),
                        refresh_token_encrypted=presenton_cloud._encrypt_token(
                            "admin-refresh"
                        ),
                        token_expires_at=get_current_utc_datetime()
                        + timedelta(hours=1),
                        scopes="presenton:api profile:read",
                    ),
                    PresentonOAuthIdentity(
                        user_id=member.id,
                        issuer="https://accounts.presenton.test",
                        subject="member-cloud-user",
                        email="member@example.com",
                        access_token_encrypted=presenton_cloud._encrypt_token(
                            "member-access"
                        ),
                        refresh_token_encrypted=presenton_cloud._encrypt_token(
                            "member-refresh"
                        ),
                        token_expires_at=get_current_utc_datetime()
                        + timedelta(hours=1),
                        scopes="presenton:api profile:read",
                    ),
                ]
            )
            await session.commit()

            provider = await presenton_cloud.migrate_legacy_presenton_credentials(
                session,
                "https://accounts.presenton.test",
            )
            identities = (
                await session.scalars(select(PresentonOAuthIdentity))
            ).all()

            assert provider is not None
            assert provider.subject == "admin-cloud-user"
            assert provider.email == "admin@example.com"
            assert presenton_cloud._decrypt_token(
                provider.access_token_encrypted
            ) == "admin-access"
            assert all(identity.access_token_encrypted is None for identity in identities)
            assert all(identity.refresh_token_encrypted is None for identity in identities)
            assert all(identity.scopes is None for identity in identities)

        await engine.dispose()

    asyncio.run(run())
