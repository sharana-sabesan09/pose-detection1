"""add exercise session metadata json

Revision ID: 0007
Revises: 0006
Create Date: 2026-04-26

"""
from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("exercise_sessions", sa.Column("metadata_json", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("exercise_sessions", "metadata_json")
