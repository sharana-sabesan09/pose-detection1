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
    with op.batch_alter_table("exercise_sessions") as batch_op:
        batch_op.add_column(sa.Column("linked_session_id", sa.String(36), nullable=True))
        batch_op.create_foreign_key(
            "fk_exercise_sessions_linked_session_id_sessions",
            "sessions",
            ["linked_session_id"],
            ["id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("exercise_sessions") as batch_op:
        batch_op.drop_constraint(
            "fk_exercise_sessions_linked_session_id_sessions",
            type_="foreignkey",
        )
        batch_op.drop_column("linked_session_id")
