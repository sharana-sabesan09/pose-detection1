"""add agent_artifacts table

Revision ID: 0006
Revises: 0005
Create Date: 2026-04-25

"""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_artifacts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("session_id", sa.String(36), sa.ForeignKey("sessions.id"), nullable=True),
        sa.Column("patient_id", sa.String(36), sa.ForeignKey("patients.id"), nullable=True),
        sa.Column("agent_name", sa.String(64), nullable=False),
        sa.Column("artifact_kind", sa.String(64), nullable=False),
        sa.Column("artifact_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("upstream_artifact_ids_json", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("data_coverage_json", sa.JSON(), nullable=False, server_default="{}"),
    )
    op.create_index("ix_aa_session_agent", "agent_artifacts", ["session_id", "agent_name"])
    op.create_index("ix_aa_patient_agent_time", "agent_artifacts", ["patient_id", "agent_name", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_aa_patient_agent_time", table_name="agent_artifacts")
    op.drop_index("ix_aa_session_agent", table_name="agent_artifacts")
    op.drop_table("agent_artifacts")
