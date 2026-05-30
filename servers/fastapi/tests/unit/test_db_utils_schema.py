"""Unit tests for DB_SCHEMA / connect-args resolution in utils.db_utils.

These are DB-free: they only assert how DATABASE_URL + DB_SCHEMA are translated
into the async engine URL and connect_args (search_path, ssl)."""

import ssl

from utils.db_utils import get_database_url_and_connect_args


def test_postgres_schema_sets_search_path(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@host:5432/db")
    monkeypatch.setenv("DB_SCHEMA", "presenton")

    url, connect_args = get_database_url_and_connect_args()

    assert url.startswith("postgresql+asyncpg://")
    assert connect_args["server_settings"]["search_path"] == "presenton, public"


def test_postgres_without_schema_has_no_search_path(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@host:5432/db")
    monkeypatch.delenv("DB_SCHEMA", raising=False)

    url, connect_args = get_database_url_and_connect_args()

    assert url.startswith("postgresql+asyncpg://")
    assert "server_settings" not in connect_args


def test_sqlite_ignores_schema(monkeypatch, tmp_path):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("APP_DATA_DIRECTORY", str(tmp_path))
    monkeypatch.setenv("DB_SCHEMA", "presenton")

    url, connect_args = get_database_url_and_connect_args()

    assert "sqlite" in url
    assert "server_settings" not in connect_args


def test_postgres_sslmode_and_schema_combine(monkeypatch):
    monkeypatch.setenv(
        "DATABASE_URL", "postgresql://u:p@host:5432/db?sslmode=require"
    )
    monkeypatch.setenv("DB_SCHEMA", "presenton")

    url, connect_args = get_database_url_and_connect_args()

    # sslmode query param is consumed/stripped and translated to an ssl context.
    assert "sslmode" not in url
    assert "ssl" in connect_args
    assert connect_args["server_settings"]["search_path"] == "presenton, public"


def test_blank_schema_is_ignored(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@host:5432/db")
    monkeypatch.setenv("DB_SCHEMA", "   ")

    _, connect_args = get_database_url_and_connect_args()

    assert "server_settings" not in connect_args


def test_sslmode_require_encrypts_without_verifying(monkeypatch):
    # 'require' = encrypt but don't verify (matches libpq + works with Supabase's pooler cert).
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@host:5432/db?sslmode=require")
    monkeypatch.delenv("DB_SCHEMA", raising=False)

    _, connect_args = get_database_url_and_connect_args()

    ctx = connect_args["ssl"]
    assert ctx.check_hostname is False
    assert ctx.verify_mode == ssl.CERT_NONE


def test_sslmode_verify_full_verifies_cert(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@host:5432/db?sslmode=verify-full")

    _, connect_args = get_database_url_and_connect_args()

    ctx = connect_args["ssl"]
    assert ctx.check_hostname is True
    assert ctx.verify_mode == ssl.CERT_REQUIRED
