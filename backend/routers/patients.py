from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import AccumulatedScore, Exercise, Patient, Session, SessionScore, Summary
from db.session import get_db
from agents.patient_advisor import run_patient_advisor
from routers.auth import require_jwt
from schemas.advice import PatientAdviceRequest, PatientAdviceResponse
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

    # Pull the most recent ~50 Exercise rows for this patient — enough to cover
    # ~10 visits at 5 exercises each. Group by visit_id so the dashboard
    # shows one card per recording visit, not one per exercise.
    exercises_result = await db.execute(
        select(Exercise)
        .where(Exercise.patient_id == patient_id)
        .order_by(Exercise.created_at.desc())
        .limit(50)
    )
    exercise_rows = exercises_result.scalars().all()

    # group_key falls back to linked_session_id for legacy rows where visit_id
    # is NULL (each pre-migration upload becomes its own one-row visit).
    visit_groups: dict[str, list[Exercise]] = {}
    visit_order: list[str] = []  # preserve newest-first ordering by first-seen
    for ex_row in exercise_rows:
        key = ex_row.visit_id or ex_row.linked_session_id or ex_row.id
        if key not in visit_groups:
            visit_groups[key] = []
            visit_order.append(key)
        visit_groups[key].append(ex_row)

    exercise_visit_count = len(visit_groups)

    # Find PT-only Sessions (Sessions with no Exercise pointing at them)
    all_sessions_result = await db.execute(
        select(Session)
        .where(Session.patient_id == patient_id)
        .order_by(Session.started_at.desc())
        .limit(50)
    )
    all_sessions = all_sessions_result.scalars().all()

    exercise_linked_session_ids = {
        ex_row.linked_session_id for ex_row in exercise_rows if ex_row.linked_session_id
    }
    pt_only_sessions = [s for s in all_sessions if s.id not in exercise_linked_session_ids]

    pt_session_count_result = await db.execute(
        select(func.count(Session.id))
        .where(Session.patient_id == patient_id)
        .where(~Session.id.in_(
            select(Exercise.linked_session_id)
            .where(Exercise.patient_id == patient_id)
            .where(Exercise.linked_session_id.is_not(None))
        ))
    )
    pt_session_count = int(pt_session_count_result.scalar() or 0)

    session_count = exercise_visit_count + pt_session_count

    # Fetch SessionScore + reporter Summary rows for everything we need to
    # display: PT sessions + the linked Sessions of every exercise visit.
    relevant_session_ids: set[str] = {s.id for s in pt_only_sessions}
    for visit_exercises in visit_groups.values():
        for ex_row in visit_exercises:
            if ex_row.linked_session_id:
                relevant_session_ids.add(ex_row.linked_session_id)

    scores_by_session_id: dict[str, SessionScore] = {}
    summary_by_session_id: dict[str, Summary] = {}
    if relevant_session_ids:
        scores_result = await db.execute(
            select(SessionScore)
            .where(SessionScore.session_id.in_(relevant_session_ids))
            .order_by(SessionScore.created_at.desc())
        )
        for row in scores_result.scalars().all():
            scores_by_session_id.setdefault(row.session_id, row)

        summaries_result = await db.execute(
            select(Summary)
            .where(
                Summary.session_id.in_(relevant_session_ids),
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

    def _agg_scores(session_ids: list[str]) -> tuple[float | None, float | None, float | None]:
        """Aggregate per-session scores across a visit (mean of available)."""
        fall = [scores_by_session_id[sid].fall_risk_score for sid in session_ids
                if sid in scores_by_session_id and scores_by_session_id[sid].fall_risk_score is not None]
        reinjury = [scores_by_session_id[sid].reinjury_risk_score for sid in session_ids
                    if sid in scores_by_session_id and scores_by_session_id[sid].reinjury_risk_score is not None]
        rom = [scores_by_session_id[sid].rom_score for sid in session_ids
               if sid in scores_by_session_id and scores_by_session_id[sid].rom_score is not None]
        return (
            sum(fall) / len(fall) if fall else None,
            sum(reinjury) / len(reinjury) if reinjury else None,
            sum(rom) / len(rom) if rom else None,
        )

    # Build merged timeline: exercise visits + PT sessions, newest-first.
    timeline_items: list[tuple[datetime, PatientSessionOverview]] = []

    for visit_key in visit_order:
        visit_exercises = visit_groups[visit_key]
        # Order within the visit by creation time so the names list reads
        # in the order the patient performed them.
        visit_exercises_ordered = sorted(visit_exercises, key=lambda e: e.created_at)
        names = [e.exercise for e in visit_exercises_ordered]
        started_ms = min(e.started_at_ms for e in visit_exercises_ordered)
        ended_ms = max(e.ended_at_ms for e in visit_exercises_ordered)
        linked_ids = [e.linked_session_id for e in visit_exercises_ordered if e.linked_session_id]
        fall, reinjury, rom = _agg_scores(linked_ids)

        # Use the most recent linked Session's reporter summary (if any) so
        # the card has a one-line clinical hook.
        visit_summary: str | None = None
        for sid in linked_ids:
            if sid in summary_by_session_id:
                visit_summary = summary_by_session_id[sid].content
                break

        # Front-end key: stick with the first exercise's row id so React keys
        # remain stable across refreshes.
        timeline_items.append((
            datetime.utcfromtimestamp(started_ms / 1000),
            PatientSessionOverview(
                session_id=visit_exercises_ordered[0].id,
                kind="exercise",
                started_at=datetime.utcfromtimestamp(started_ms / 1000),
                ended_at=datetime.utcfromtimestamp(ended_ms / 1000),
                exercise=names[0] if names else None,
                exercises=names,
                num_exercises=len(names),
                summary=visit_summary,
                fall_risk_score=fall,
                reinjury_risk_score=reinjury,
                rom_score=rom,
            ),
        ))

    for s in pt_only_sessions:
        score = scores_by_session_id.get(s.id)
        timeline_items.append((
            s.started_at,
            PatientSessionOverview(
                session_id=s.id,
                kind="pt",
                started_at=s.started_at,
                ended_at=s.ended_at,
                exercise=None,
                exercises=[],
                num_exercises=0,
                summary=summary_by_session_id[s.id].content if s.id in summary_by_session_id else None,
                fall_risk_score=score.fall_risk_score if score else None,
                reinjury_risk_score=score.reinjury_risk_score if score else None,
                rom_score=score.rom_score if score else None,
            ),
        ))

    timeline_items.sort(key=lambda item: item[0], reverse=True)
    recent_sessions = [item[1] for item in timeline_items[:10]]

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


@router.post("/{patient_id}/advice", response_model=PatientAdviceResponse)
async def ask_patient_advice(
    patient_id: str,
    body: PatientAdviceRequest,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_jwt),
):
    output = await run_patient_advisor(patient_id, body.question, db)
    await db.commit()
    return output
