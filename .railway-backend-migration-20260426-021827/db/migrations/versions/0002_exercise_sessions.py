"""add exercise_sessions and rep_analyses tables

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-25

"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "exercise_sessions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("patient_id", sa.String(36), sa.ForeignKey("patients.id"), nullable=True),
        sa.Column("mobile_session_id", sa.String(64), nullable=False, unique=True),
        sa.Column("exercise", sa.String(64), nullable=False),
        sa.Column("num_reps", sa.Integer(), nullable=False),
        sa.Column("started_at_ms", sa.Float(), nullable=False),
        sa.Column("ended_at_ms", sa.Float(), nullable=False),
        sa.Column("duration_ms", sa.Float(), nullable=False),
        sa.Column("summary_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "rep_analyses",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("exercise_session_id", sa.String(36), sa.ForeignKey("exercise_sessions.id"), nullable=False),
        sa.Column("rep_id", sa.Integer(), nullable=False),
        sa.Column("side", sa.String(10), nullable=False),
        # Timing
        sa.Column("start_frame", sa.Integer(), nullable=True),
        sa.Column("bottom_frame", sa.Integer(), nullable=True),
        sa.Column("end_frame", sa.Integer(), nullable=True),
        sa.Column("rep_duration_ms", sa.Float(), nullable=True),
        # Features
        sa.Column("knee_flexion_deg", sa.Float(), nullable=True),
        sa.Column("rom_ratio", sa.Float(), nullable=True),
        sa.Column("fppa_peak", sa.Float(), nullable=True),
        sa.Column("fppa_at_depth", sa.Float(), nullable=True),
        sa.Column("trunk_lean_peak", sa.Float(), nullable=True),
        sa.Column("trunk_flex_peak", sa.Float(), nullable=True),
        sa.Column("pelvic_drop_peak", sa.Float(), nullable=True),
        sa.Column("pelvic_shift_peak", sa.Float(), nullable=True),
        sa.Column("hip_adduction_peak", sa.Float(), nullable=True),
        sa.Column("knee_offset_peak", sa.Float(), nullable=True),
        sa.Column("sway_norm", sa.Float(), nullable=True),
        sa.Column("smoothness", sa.Float(), nullable=True),
        # Errors
        sa.Column("knee_valgus", sa.Boolean(), nullable=True),
        sa.Column("trunk_lean", sa.Boolean(), nullable=True),
        sa.Column("trunk_flex", sa.Boolean(), nullable=True),
        sa.Column("pelvic_drop", sa.Boolean(), nullable=True),
        sa.Column("pelvic_shift", sa.Boolean(), nullable=True),
        sa.Column("hip_adduction", sa.Boolean(), nullable=True),
        sa.Column("knee_over_foot", sa.Boolean(), nullable=True),
        sa.Column("balance", sa.Boolean(), nullable=True),
        # Score
        sa.Column("total_errors", sa.Integer(), nullable=True),
        sa.Column("classification", sa.String(32), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("rep_analyses")
    op.drop_table("exercise_sessions")
