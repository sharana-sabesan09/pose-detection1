import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import AgentArtifact


async def write_artifact(
    agent_name: str,
    session_id: str | None,
    patient_id: str,
    artifact_kind: str,
    artifact_json: dict,
    upstream_artifact_ids: list[str],
    data_coverage: dict,
    db: AsyncSession,
) -> str:
    """Persist an agent artifact.

    Idempotency rules:
    - session-level (session_id provided): gate on (session_id, agent_name) — skip if exists.
    - patient-level (session_id=None): gate on (patient_id, agent_name) — update in place if exists,
      so patient-level agents (e.g. progress_agent) never accumulate duplicate rows.
    """
    if session_id:
        existing = await db.execute(
            select(AgentArtifact).where(
                AgentArtifact.session_id == session_id,
                AgentArtifact.agent_name == agent_name,
            )
        )
        row = existing.scalars().first()
        if row:
            return row.id
    else:
        existing = await db.execute(
            select(AgentArtifact).where(
                AgentArtifact.patient_id == patient_id,
                AgentArtifact.agent_name == agent_name,
                AgentArtifact.session_id.is_(None),
            )
        )
        row = existing.scalars().first()
        if row:
            row.artifact_json = artifact_json
            row.upstream_artifact_ids_json = upstream_artifact_ids
            row.data_coverage_json = data_coverage
            row.created_at = datetime.utcnow()
            await db.flush()
            return row.id

    artifact_id = str(uuid.uuid4())
    db.add(AgentArtifact(
        id=artifact_id,
        session_id=session_id,
        patient_id=patient_id,
        agent_name=agent_name,
        artifact_kind=artifact_kind,
        artifact_json=artifact_json,
        created_at=datetime.utcnow(),
        upstream_artifact_ids_json=upstream_artifact_ids,
        data_coverage_json=data_coverage,
    ))
    await db.flush()
    return artifact_id


async def get_artifact_id(
    session_id: str,
    agent_name: str,
    db: AsyncSession,
) -> str | None:
    """Look up the artifact ID written by agent_name for a given session."""
    result = await db.execute(
        select(AgentArtifact.id).where(
            AgentArtifact.session_id == session_id,
            AgentArtifact.agent_name == agent_name,
        )
    )
    return result.scalars().first()
