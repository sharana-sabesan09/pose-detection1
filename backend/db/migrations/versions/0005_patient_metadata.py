"""add patient metadata json

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-25

"""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("patients", sa.Column("metadata_json", sa.JSON(), nullable=True))
    op.add_column("patients", sa.Column("updated_at", sa.DateTime(), nullable=True))
    op.execute("UPDATE patients SET updated_at = created_at WHERE updated_at IS NULL")
    op.alter_column("patients", "updated_at", existing_type=sa.DateTime(), nullable=False)


def downgrade() -> None:
    op.drop_column("patients", "updated_at")
    op.drop_column("patients", "metadata_json")
