"""visit linkage on exercise_sessions and multi_exercise_sessions archive

Revision ID: 0009
Revises: 0008
Create Date: 2026-04-25

Adds two pieces:

  1. Per-exercise visit linkage on the existing ``exercise_sessions`` table:
     ``visit_id`` (the top-level MultiExerciseSession.sessionId from the
     mobile app — shared across the 5 rows produced by one recording visit)
     and ``injured_joint_rom`` (denormalised carve-out from
     patient.injuredJoint.romByExercise so longitudinal agents can query
     a single table without joins).

  2. ``multi_exercise_sessions`` — write-only archive table that stores the
     full MultiExerciseSession JSON payload verbatim. The current ingest
     path does NOT read from this table; it exists for a future
     longitudinal report agent.
"""
from alembic import op
import sqlalchemy as sa

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "exercise_sessions",
        sa.Column("visit_id", sa.String(64), nullable=True),
    )
    op.add_column(
        "exercise_sessions",
        sa.Column("injured_joint_rom", sa.JSON(), nullable=True),
    )
    op.create_index(
        "ix_exercise_sessions_visit_id",
        "exercise_sessions",
        ["visit_id"],
    )
    op.create_index(
        "ix_exercise_sessions_patient_visit",
        "exercise_sessions",
        ["patient_id", "visit_id"],
    )

    op.create_table(
        "multi_exercise_sessions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("visit_id", sa.String(64), nullable=False, unique=True),
        sa.Column("patient_id", sa.String(36), sa.ForeignKey("patients.id"), nullable=True),
        sa.Column("started_at_ms", sa.Float(), nullable=False),
        sa.Column("ended_at_ms", sa.Float(), nullable=False),
        sa.Column("duration_ms", sa.Float(), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_multi_exercise_sessions_visit_id",
        "multi_exercise_sessions",
        ["visit_id"],
        unique=True,
    )
    op.create_index(
        "ix_multi_patient_created",
        "multi_exercise_sessions",
        ["patient_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_multi_patient_created", table_name="multi_exercise_sessions")
    op.drop_index("ix_multi_exercise_sessions_visit_id", table_name="multi_exercise_sessions")
    op.drop_table("multi_exercise_sessions")

    op.drop_index("ix_exercise_sessions_patient_visit", table_name="exercise_sessions")
    op.drop_index("ix_exercise_sessions_visit_id", table_name="exercise_sessions")
    op.drop_column("exercise_sessions", "injured_joint_rom")
    op.drop_column("exercise_sessions", "visit_id")
