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
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_columns = {column["name"] for column in inspector.get_columns("patients")}

    if "metadata_json" not in existing_columns:
        op.add_column("patients", sa.Column("metadata_json", sa.JSON(), nullable=True))

    if "updated_at" not in existing_columns:
        op.add_column("patients", sa.Column("updated_at", sa.DateTime(), nullable=True))

    op.execute("UPDATE patients SET updated_at = created_at WHERE updated_at IS NULL")
    with op.batch_alter_table("patients") as batch_op:
        batch_op.alter_column("updated_at", existing_type=sa.DateTime(), nullable=False)


def downgrade() -> None:
    with op.batch_alter_table("patients") as batch_op:
        batch_op.drop_column("updated_at")
    op.drop_column("patients", "metadata_json")
