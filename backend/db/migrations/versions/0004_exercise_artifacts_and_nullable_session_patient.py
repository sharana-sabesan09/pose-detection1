"""store exercise CSV artifacts and allow anonymous linked sessions

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-25

"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("sessions", "patient_id", existing_type=sa.String(36), nullable=True)
    op.add_column("exercise_sessions", sa.Column("reps_csv", sa.Text(), nullable=True))
    op.add_column("exercise_sessions", sa.Column("frame_features_csv", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("exercise_sessions", "frame_features_csv")
    op.drop_column("exercise_sessions", "reps_csv")
    op.alter_column("sessions", "patient_id", existing_type=sa.String(36), nullable=False)
