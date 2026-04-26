"""create exercise_session_artifacts table

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
    op.create_table(
        "exercise_session_artifacts",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("exercise_session_id", sa.String(length=36), sa.ForeignKey("exercise_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("artifact_type", sa.String(length=64), nullable=False),
        sa.Column("content_type", sa.String(length=128), nullable=False),
        sa.Column("bytes", sa.LargeBinary(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_exercise_session_artifacts_session_type_created",
        "exercise_session_artifacts",
        ["exercise_session_id", "artifact_type", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_exercise_session_artifacts_session_type_created", table_name="exercise_session_artifacts")
    op.drop_table("exercise_session_artifacts")

