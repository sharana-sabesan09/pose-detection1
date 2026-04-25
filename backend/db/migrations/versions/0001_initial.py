"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-04-24

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "patients",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("name_encrypted", sa.Text(), nullable=True),
        sa.Column("dob_encrypted", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "sessions",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("patient_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("patients.id"), nullable=False),
        sa.Column("pt_plan", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "session_scores",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("session_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("fall_risk_score", sa.Float(), nullable=True),
        sa.Column("reinjury_risk_score", sa.Float(), nullable=True),
        sa.Column("pain_score", sa.Float(), nullable=True),
        sa.Column("rom_score", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "accumulated_scores",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("patient_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("patients.id"), nullable=False, unique=True),
        sa.Column("fall_risk_avg", sa.Float(), nullable=True),
        sa.Column("reinjury_risk_avg", sa.Float(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "pose_frames",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("session_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("timestamp", sa.Float(), nullable=False),
        sa.Column("angles_json", postgresql.JSONB(), nullable=False),
    )

    op.create_table(
        "summaries",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("session_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("sessions.id"), nullable=True),
        sa.Column("agent_name", sa.String(64), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "audit_log",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("actor", sa.String(128), nullable=False),
        sa.Column("action", sa.String(256), nullable=False),
        sa.Column("patient_id", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column("data_type", sa.String(128), nullable=False),
        sa.Column("timestamp", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("audit_log")
    op.drop_table("summaries")
    op.drop_table("pose_frames")
    op.drop_table("accumulated_scores")
    op.drop_table("session_scores")
    op.drop_table("sessions")
    op.drop_table("patients")
