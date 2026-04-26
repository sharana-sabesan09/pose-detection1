"""add pose landmark storage for overlays

Revision ID: 0006
Revises: 0005
Create Date: 2026-04-26
"""

from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("pose_frames", sa.Column("landmarks_json", sa.JSON(), nullable=True))
    op.add_column("exercise_sessions", sa.Column("frames_csv", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("exercise_sessions", "frames_csv")
    op.drop_column("pose_frames", "landmarks_json")

