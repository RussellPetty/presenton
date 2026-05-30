"""add user_id columns for per-user data isolation

Revision ID: b7d9e2f04a13
Revises: c7b70d0f31b1
Create Date: 2026-05-30

Adds a nullable, indexed ``user_id`` to every user-owned table so presentations,
slides, images, chat, templates, etc. can be scoped per user (see
utils/request_scope.py). Existing rows are backfilled to the ``local`` sentinel
(LOCAL_USER_ID) so they stay visible when auth is disabled. Idempotent and
dialect-safe (SQLite dev + Postgres prod); inherits the active schema via the
connection's search_path (set in alembic/env.py).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = "b7d9e2f04a13"
down_revision: Union[str, None] = "c7b70d0f31b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# User-owned tables that gain a user_id column.
_SCOPED_TABLES = (
    "presentations",
    "slides",
    "imageasset",
    "chat_history_messages",
    "async_presentation_generation_tasks",
    "presentation_layout_codes",
    "templates",
    "template_create_infos",
)

# Pre-multitenancy rows are assigned to this sentinel, matching LOCAL_USER_ID in
# utils/request_scope.py (the effective user when auth is disabled).
_LEGACY_USER_ID = "local"


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    insp = _inspector()
    if table_name not in insp.get_table_names():
        return False
    return column_name in {c["name"] for c in insp.get_columns(table_name)}


def _has_index(table_name: str, index_name: str) -> bool:
    insp = _inspector()
    if table_name not in insp.get_table_names():
        return False
    return index_name in {ix["name"] for ix in insp.get_indexes(table_name)}


def upgrade() -> None:
    for table in _SCOPED_TABLES:
        if not _has_table(table):
            continue
        if not _has_column(table, "user_id"):
            op.add_column(
                table,
                sa.Column("user_id", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
            )
        ix = op.f(f"ix_{table}_user_id")
        if not _has_index(table, ix):
            op.create_index(ix, table, ["user_id"], unique=False)
        # Backfill existing rows so they remain visible in disabled-auth mode.
        op.execute(
            f"UPDATE {table} SET user_id = '{_LEGACY_USER_ID}' WHERE user_id IS NULL"
        )

    # Composite indexes for the hottest per-user list queries. Guarded on
    # created_at existing so partial/legacy schemas (e.g. test fixtures that
    # hand-build a minimal table) don't break the migration.
    if (
        _has_table("presentations")
        and _has_column("presentations", "created_at")
        and not _has_index("presentations", "ix_presentations_user_id_created_at")
    ):
        op.create_index(
            "ix_presentations_user_id_created_at",
            "presentations",
            ["user_id", "created_at"],
            unique=False,
        )
    if (
        _has_table("imageasset")
        and _has_column("imageasset", "created_at")
        and not _has_index("imageasset", "ix_imageasset_user_id_created_at")
    ):
        op.create_index(
            "ix_imageasset_user_id_created_at",
            "imageasset",
            ["user_id", "created_at"],
            unique=False,
        )


def downgrade() -> None:
    for table, ix_name in (
        ("presentations", "ix_presentations_user_id_created_at"),
        ("imageasset", "ix_imageasset_user_id_created_at"),
    ):
        if _has_index(table, ix_name):
            op.drop_index(ix_name, table_name=table)

    for table in _SCOPED_TABLES:
        if not _has_table(table):
            continue
        ix = op.f(f"ix_{table}_user_id")
        if _has_index(table, ix):
            op.drop_index(ix, table_name=table)
        if _has_column(table, "user_id"):
            op.drop_column(table, "user_id")
