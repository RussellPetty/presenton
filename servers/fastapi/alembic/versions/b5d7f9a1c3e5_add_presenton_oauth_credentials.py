"""add encrypted Presenton OAuth credentials

Revision ID: b5d7f9a1c3e5
Revises: a4c6e8f0b2d4
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b5d7f9a1c3e5"
down_revision: str | None = "a4c6e8f0b2d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing = {
        column["name"]
        for column in inspector.get_columns("presenton_oauth_identity")
    }
    additions = (
        ("access_token_encrypted", sa.Text()),
        ("refresh_token_encrypted", sa.Text()),
        ("token_expires_at", sa.DateTime(timezone=True)),
        ("scopes", sa.Text()),
    )
    with op.batch_alter_table("presenton_oauth_identity") as batch_op:
        for name, column_type in additions:
            if name not in existing:
                batch_op.add_column(sa.Column(name, column_type, nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing = {
        column["name"]
        for column in inspector.get_columns("presenton_oauth_identity")
    }
    with op.batch_alter_table("presenton_oauth_identity") as batch_op:
        for name in (
            "scopes",
            "token_expires_at",
            "refresh_token_encrypted",
            "access_token_encrypted",
        ):
            if name in existing:
                batch_op.drop_column(name)
