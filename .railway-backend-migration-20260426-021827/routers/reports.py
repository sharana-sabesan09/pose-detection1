from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from db.session import get_db
from db.models import Summary, Session as SessionModel
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
    )


@router.get("/{patient_id}/progress", response_model=ProgressOutput)
async def get_progress_report(
    patient_id: str,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_jwt),
):
    return await run_progress(patient_id, db)
