"""add Presenton OAuth identity mapping

Revision ID: a4c6e8f0b2d4
Revises: f3a7c1d9e5b2
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "a4c6e8f0b2d4"
down_revision: str | None = "f3a7c1d9e5b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "presenton_oauth_identity" in inspector.get_table_names():
        return
    op.create_table(
        "presenton_oauth_identity",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("issuer", sa.String(length=512), nullable=False),
        sa.Column("subject", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "issuer",
            "subject",
            name="uq_presenton_oauth_identity_issuer_subject",
        ),
    )
    op.create_index(
        "ix_presenton_oauth_identity_user_id",
        "presenton_oauth_identity",
        ["user_id"],
        unique=True,
    )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "presenton_oauth_identity" not in inspector.get_table_names():
        return
    op.drop_index(
        "ix_presenton_oauth_identity_user_id",
        table_name="presenton_oauth_identity",
    )
    op.drop_table("presenton_oauth_identity")
