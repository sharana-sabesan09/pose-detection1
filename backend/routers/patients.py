from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import AccumulatedScore, ExerciseSession, Patient, Session, SessionScore, Summary
from db.session import get_db
from routers.auth import require_jwt
from schemas.patient import (
    AccumulatedScoresResponse,
    PatientOverviewResponse,
    PatientResponse,
    PatientSessionOverview,
    PatientUpsertRequest,
)

router = APIRouter(prefix="/patients", tags=["patients"])


def _to_response(patient: Patient) -> PatientResponse:
    return PatientResponse(
        id=patient.id,
        metadata=patient.metadata_json,
        created_at=patient.created_at,
        updated_at=patient.updated_at,
    )


@router.put("/{patient_id}", response_model=PatientResponse)
async def upsert_patient(
    patient_id: str,
    body: PatientUpsertRequest,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_jwt),
):
    result = await db.execute(select(Patient).where(Patient.id == patient_id))
    patient = result.scalars().first()

    if patient:
        patient.metadata_json = body.model_dump()
        patient.updated_at = datetime.utcnow()
    else:
        patient = Patient(
            id=patient_id,
            metadata_json=body.model_dump(),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(patient)

    await db.commit()
    await db.refresh(patient)
    return _to_response(patient)


@router.get("/{patient_id}", response_model=PatientResponse)
async def get_patient(
    patient_id: str,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_jwt),
):
    result = await db.execute(select(Patient).where(Patient.id == patient_id))
    patient = result.scalars().first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    return _to_response(patient)


@router.get("/{patient_id}/overview", response_model=PatientOverviewResponse)
async def get_patient_overview(
    patient_id: str,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_jwt),
):
    result = await db.execute(select(Patient).where(Patient.id == patient_id))
    patient = result.scalars().first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    session_count_result = await db.execute(
        select(func.count(Session.id)).where(Session.patient_id == patient_id)
    )
    session_count = int(session_count_result.scalar() or 0)

    sessions_result = await db.execute(
        select(Session)
        .where(Session.patient_id == patient_id)
        .order_by(Session.started_at.desc())
        .limit(10)
    )
    sessions = sessions_result.scalars().all()
    session_ids = [s.id for s in sessions]

    exercise_by_session_id: dict[str, ExerciseSession] = {}
    scores_by_session_id: dict[str, SessionScore] = {}
    summary_by_session_id: dict[str, Summary] = {}

    if session_ids:
        exercise_result = await db.execute(
            select(ExerciseSession).where(ExerciseSession.linked_session_id.in_(session_ids))
        )
        exercise_by_session_id = {
            row.linked_session_id: row for row in exercise_result.scalars().all() if row.linked_session_id
        }

        scores_result = await db.execute(
            select(SessionScore)
            .where(SessionScore.session_id.in_(session_ids))
            .order_by(SessionScore.created_at.desc())
        )
        for row in scores_result.scalars().all():
            scores_by_session_id.setdefault(row.session_id, row)

        summaries_result = await db.execute(
            select(Summary)
            .where(
                Summary.session_id.in_(session_ids),
                Summary.agent_name == "reporter",
            )
            .order_by(Summary.created_at.desc())
        )
        for row in summaries_result.scalars().all():
            if row.session_id:
                summary_by_session_id.setdefault(row.session_id, row)

    accumulated_result = await db.execute(
        select(AccumulatedScore).where(AccumulatedScore.patient_id == patient_id)
    )
    accumulated = accumulated_result.scalars().first()

    recent_sessions = [
        PatientSessionOverview(
            session_id=session.id,
            kind="exercise" if session.id in exercise_by_session_id else "pt",
            started_at=session.started_at,
            ended_at=session.ended_at,
            exercise=exercise_by_session_id.get(session.id).exercise if session.id in exercise_by_session_id else None,
            summary=summary_by_session_id.get(session.id).content if session.id in summary_by_session_id else None,
            fall_risk_score=scores_by_session_id.get(session.id).fall_risk_score if session.id in scores_by_session_id else None,
            reinjury_risk_score=scores_by_session_id.get(session.id).reinjury_risk_score if session.id in scores_by_session_id else None,
            rom_score=scores_by_session_id.get(session.id).rom_score if session.id in scores_by_session_id else None,
        )
        for session in sessions
    ]

    return PatientOverviewResponse(
        id=patient.id,
        metadata=patient.metadata_json,
        created_at=patient.created_at,
        updated_at=patient.updated_at,
        session_count=session_count,
        accumulated_scores=(
            AccumulatedScoresResponse(
                fall_risk_avg=accumulated.fall_risk_avg,
                reinjury_risk_avg=accumulated.reinjury_risk_avg,
            )
            if accumulated
            else None
        ),
        recent_sessions=recent_sessions,
    )
