"""add calibration batch/step ids to exercise_sessions

Revision ID: 0010
Revises: 0009
Create Date: 2026-04-26
"""

from alembic import op
import sqlalchemy as sa


revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("exercise_sessions", sa.Column("calibration_batch_id", sa.String(length=64), nullable=True))
    op.add_column("exercise_sessions", sa.Column("calibration_step", sa.Integer(), nullable=True))

    op.create_index(
        "ix_exercise_sessions_calibration_batch_step",
        "exercise_sessions",
        ["patient_id", "calibration_batch_id", "calibration_step"],
        unique=False,
    )

    # Prevent duplicate steps within a calibration batch (Postgres partial unique indexes).
    op.execute(
        """
        CREATE UNIQUE INDEX uq_exercise_sessions_calibration_step_patient
        ON exercise_sessions (patient_id, calibration_batch_id, calibration_step)
        WHERE calibration_batch_id IS NOT NULL
          AND calibration_step IS NOT NULL
          AND patient_id IS NOT NULL;
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX uq_exercise_sessions_calibration_step_anon
        ON exercise_sessions (calibration_batch_id, calibration_step)
        WHERE calibration_batch_id IS NOT NULL
          AND calibration_step IS NOT NULL
          AND patient_id IS NULL;
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_exercise_sessions_calibration_step_anon;")
    op.execute("DROP INDEX IF EXISTS uq_exercise_sessions_calibration_step_patient;")
    op.drop_index("ix_exercise_sessions_calibration_batch_step", table_name="exercise_sessions")
    op.drop_column("exercise_sessions", "calibration_step")
    op.drop_column("exercise_sessions", "calibration_batch_id")
