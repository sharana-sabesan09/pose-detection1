import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from db.session import get_db
from db.models import Session, PoseFrame
from schemas.session import IntakeInput, ReporterOutput
from schemas.report import SessionStartRequest, SessionStartResponse, FrameRequest
from agents.orchestrator import run_session_pipeline
from routers.auth import require_jwt

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.post("/start", response_model=SessionStartResponse)
async def start_session(
    body: SessionStartRequest,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_jwt),
):
    session = Session(
        id=str(uuid.uuid4()),
        patient_id=body.patient_id,
        pt_plan=body.pt_plan,
        started_at=datetime.utcnow(),
    )
    db.add(session)
    await db.commit()
    return SessionStartResponse(session_id=session.id)


@router.post("/{session_id}/frame")
async def add_frame(
    session_id: str,
    body: FrameRequest,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_jwt),
):
    frame = PoseFrame(
        id=str(uuid.uuid4()),
        session_id=session_id,
        timestamp=body.timestamp,
        angles_json=body.angles_json,
    )
    db.add(frame)
    await db.commit()
    return {"status": "ok"}


@router.post("/{session_id}/end", response_model=ReporterOutput)
async def end_session(
    session_id: str,
    body: IntakeInput,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_jwt),
):
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalars().first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.ended_at = datetime.utcnow()
    await db.commit()

    pipeline_result = await run_session_pipeline(
        session_id=session_id,
        patient_id=body.patient_id,
        intake_data=body,
        db=db,
    )

    reporter = pipeline_result.get("reporter")
    if not reporter:
        raise HTTPException(status_code=500, detail="Pipeline failed")

    return ReporterOutput(**reporter)
