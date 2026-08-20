"""add aspect ratio to presentations

Revision ID: 4e4b28a43120
Revises: c7b70d0f31b1
Create Date: 2026-08-20

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "4e4b28a43120"
down_revision: Union[str, None] = "c7b70d0f31b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    if table_name not in inspector.get_table_names():
        return False
    return column_name in {
        column["name"] for column in inspector.get_columns(table_name)
    }


def upgrade() -> None:
    if not _has_column("presentations", "aspect_ratio"):
        with op.batch_alter_table("presentations") as batch_op:
            batch_op.add_column(
                sa.Column(
                    "aspect_ratio",
                    sa.String(),
                    nullable=False,
                    server_default="16:9",
                )
            )


def downgrade() -> None:
    if _has_column("presentations", "aspect_ratio"):
        with op.batch_alter_table("presentations") as batch_op:
            batch_op.drop_column("aspect_ratio")
