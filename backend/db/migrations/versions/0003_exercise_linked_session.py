"""link exercise_sessions to sessions for frame ingestion

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-25

"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "exercise_sessions",
        sa.Column(
            "linked_session_id",
            sa.String(36),
            sa.ForeignKey("sessions.id"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("exercise_sessions", "linked_session_id")
