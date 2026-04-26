from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from db.session import get_db
from db.models import AgentArtifact, Summary, Session as SessionModel
from schemas.session import ReporterOutput, ProgressOutput
from agents.progress import run_progress
from routers.auth import require_jwt

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/{patient_id}/latest", response_model=ReporterOutput)
async def get_latest_report(
    patient_id: str,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_jwt),
):
    artifact_result = await db.execute(
        select(AgentArtifact)
        .join(SessionModel, AgentArtifact.session_id == SessionModel.id)
        .where(
            AgentArtifact.agent_name == "reporter_agent",
            AgentArtifact.artifact_kind == "reporter_output",
            SessionModel.patient_id == patient_id,
        )
        .order_by(AgentArtifact.created_at.desc())
        .limit(1)
    )
    latest_artifact = artifact_result.scalars().first()
    if latest_artifact:
        metrics = latest_artifact.artifact_json.get("metrics", {})
        summary = metrics.get("summary")
        if summary:
            return ReporterOutput(
                summary=summary,
                session_highlights=metrics.get("session_highlights", []),
                recommendations=metrics.get("recommendations", []),
                evidence_map=metrics.get("evidence_map", {}),
                contributing_factors=metrics.get("contributing_factors", []),
                good_reps=metrics.get("good_reps"),
                filtered_reps=metrics.get("filtered_reps"),
                reportability=metrics.get("reportability", "unknown"),
                data_coverage=latest_artifact.data_coverage_json or {},
            )

    result = await db.execute(
        select(Summary)
        .join(SessionModel, Summary.session_id == SessionModel.id)
        .where(
            Summary.agent_name == "reporter",
            SessionModel.patient_id == patient_id,
        )
        .order_by(Summary.created_at.desc())
        .limit(1)
    )
    summary = result.scalars().first()
    if not summary:
        raise HTTPException(status_code=404, detail="No reports found for this patient")

    return ReporterOutput(
        summary=summary.content,
        session_highlights=[],
        recommendations=[],
        evidence_map={},
        contributing_factors=[],
        reportability="unknown",
        data_coverage={
            "required_fields_present": False,
            "missing_fields": ["structured_report_artifact"],
            "notes": [
                "Showing a legacy summary because no structured reporter artifact is available for this report.",
            ],
        },
    )


@router.get("/{patient_id}/progress", response_model=ProgressOutput)
async def get_progress_report(
    patient_id: str,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_jwt),
):
    artifact_result = await db.execute(
        select(AgentArtifact)
        .where(
            AgentArtifact.agent_name == "progress_agent",
            AgentArtifact.artifact_kind == "progress_output",
            AgentArtifact.patient_id == patient_id,
        )
        .order_by(AgentArtifact.created_at.desc())
        .limit(1)
    )
    latest_artifact = artifact_result.scalars().first()
    if latest_artifact:
        metrics = latest_artifact.artifact_json.get("metrics", {})
        longitudinal_report = metrics.get("longitudinal_report")
        if longitudinal_report:
            return ProgressOutput(
                longitudinal_report=longitudinal_report,
                overall_trend=metrics.get("overall_trend"),
                milestones_reached=metrics.get("milestones_reached", []),
                next_goals=metrics.get("next_goals", []),
                evidence_citations=metrics.get("evidence_citations", {}),
                data_warnings=metrics.get(
                    "data_warnings",
                    latest_artifact.data_coverage_json.get("notes", []),
                ),
            )

    output = await run_progress(patient_id, db)
    await db.commit()
    return output
