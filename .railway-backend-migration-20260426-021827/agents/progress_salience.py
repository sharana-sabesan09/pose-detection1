"""
progress_salience.py — Deterministic pre-processing for the progress agent.

Two pure async functions:
  build_patient_timeline() — assembles structured facts from DB
  compute_salience()       — selects sessions and metrics worth reporting

Neither function calls an LLM.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import AgentArtifact, ExerciseSession, Patient, Session, SessionScore, Summary


@dataclass
class SessionFact:
    session_id: str
    created_at: datetime
    source_type: str               # "pt_session" | "exercise_session"
    session_type: str              # "assessment" | "treatment" | "home_exercise_check"
    scores: dict                   # {fall_risk_score, reinjury_risk_score, pain_score, rom_score}
    injured_joint_rom: dict        # {joint_name: rom_value} extracted from pose artifact
    flagged_joints: list[str]
    data_sufficient: bool          # from reinjury artifact
    reporter_summary: str
    evidence_map: dict             # from reporter artifact


@dataclass
class PatientTimeline:
    sessions: list[SessionFact]
    injured_joints: list[str]
    rehab_phase: str


@dataclass
class SalienceReport:
    salient_session_ids: list[str]
    salient_metrics: dict          # {metric_name: {direction, values, delta_vs_baseline, session_ids, score_range}}
    salient_summaries: list[str]   # reporter summary text for salient sessions only
    data_warnings: list[str]
    why_selected: dict             # {session_id: human-readable reason string}


async def build_patient_timeline(patient_id: str, db: AsyncSession) -> PatientTimeline:
    sessions_result = await db.execute(
        select(Session)
        .where(Session.patient_id == patient_id)
        .order_by(Session.started_at.asc())
    )
    sessions = sessions_result.scalars().all()
    if not sessions:
        return PatientTimeline(sessions=[], injured_joints=[], rehab_phase="unknown")

    session_ids = [s.id for s in sessions]

    # Patient metadata
    patient_result = await db.execute(select(Patient).where(Patient.id == patient_id))
    patient = patient_result.scalars().first()
    meta: dict = (patient.metadata_json or {}) if patient else {}
    injured_joints: list[str] = meta.get("injured_joints", [])
    rehab_phase: str = meta.get("rehab_phase", "unknown")

    # Session scores indexed by session_id (keep earliest per session)
    scores_result = await db.execute(
        select(SessionScore)
        .join(Session, SessionScore.session_id == Session.id)
        .where(Session.patient_id == patient_id)
        .order_by(SessionScore.created_at.asc())
    )
    scores_by_session: dict[str, SessionScore] = {}
    for row in scores_result.scalars().all():
        scores_by_session.setdefault(row.session_id, row)

    # Agent artifacts indexed by (session_id, agent_name)
    artifacts_result = await db.execute(
        select(AgentArtifact)
        .where(
            AgentArtifact.patient_id == patient_id,
            AgentArtifact.agent_name.in_(["intake_agent", "pose_analysis_agent", "reinjury_risk_agent", "reporter_agent"]),
        )
        .order_by(AgentArtifact.created_at.asc())
    )
    artifacts_by_key: dict[tuple[str, str], AgentArtifact] = {}
    for row in artifacts_result.scalars().all():
        if row.session_id:
            artifacts_by_key[(row.session_id, row.agent_name)] = row

    # Reporter summaries indexed by session_id
    summaries_result = await db.execute(
        select(Summary)
        .where(Summary.session_id.in_(session_ids), Summary.agent_name == "reporter")
        .order_by(Summary.created_at.asc())
    )
    summary_by_session: dict[str, str] = {}
    for row in summaries_result.scalars().all():
        if row.session_id:
            summary_by_session.setdefault(row.session_id, row.content)

    # Exercise session IDs (to determine source_type)
    ex_result = await db.execute(
        select(ExerciseSession.linked_session_id)
        .where(ExerciseSession.linked_session_id.in_(session_ids))
    )
    exercise_linked_ids = {row[0] for row in ex_result.all() if row[0]}

    facts: list[SessionFact] = []
    for session in sessions:
        sid = session.id
        score = scores_by_session.get(sid)
        scores = {
            "fall_risk_score": score.fall_risk_score if score else None,
            "reinjury_risk_score": score.reinjury_risk_score if score else None,
            "pain_score": score.pain_score if score else None,
            "rom_score": score.rom_score if score else None,
        }

        intake_art = artifacts_by_key.get((sid, "intake_agent"))
        session_type = "treatment"
        if intake_art:
            session_type = intake_art.artifact_json.get("metrics", {}).get("session_type", "treatment")

        pose_art = artifacts_by_key.get((sid, "pose_analysis_agent"))
        injured_joint_rom: dict[str, float] = {}
        flagged_joints: list[str] = []
        if pose_art:
            metrics = pose_art.artifact_json.get("metrics", {})
            for joint, stats in metrics.get("joint_stats", {}).items():
                if "rom" in stats:
                    injured_joint_rom[joint] = stats["rom"]
            flagged_joints = metrics.get("flagged_joints", [])

        reinjury_art = artifacts_by_key.get((sid, "reinjury_risk_agent"))
        data_sufficient = False
        if reinjury_art:
            data_sufficient = reinjury_art.artifact_json.get("metrics", {}).get("data_sufficient", False)

        reporter_art = artifacts_by_key.get((sid, "reporter_agent"))
        evidence_map: dict = {}
        if reporter_art:
            evidence_map = reporter_art.artifact_json.get("metrics", {}).get("evidence_map", {})

        facts.append(SessionFact(
            session_id=sid,
            created_at=session.started_at,
            source_type="exercise_session" if sid in exercise_linked_ids else "pt_session",
            session_type=session_type,
            scores=scores,
            injured_joint_rom=injured_joint_rom,
            flagged_joints=flagged_joints,
            data_sufficient=data_sufficient,
            reporter_summary=summary_by_session.get(sid, ""),
            evidence_map=evidence_map,
        ))

    return PatientTimeline(sessions=facts, injured_joints=injured_joints, rehab_phase=rehab_phase)


def compute_salience(timeline: PatientTimeline) -> SalienceReport:
    if not timeline.sessions:
        return SalienceReport(
            salient_session_ids=[],
            salient_metrics={},
            salient_summaries=[],
            data_warnings=[],
            why_selected={},
        )

    salient_session_ids: list[str] = []
    salient_metrics: dict = {}
    data_warnings: list[str] = []
    why_selected: dict[str, list[str]] = {}

    def _add_salient(sid: str, reason: str) -> None:
        if sid not in salient_session_ids:
            salient_session_ids.append(sid)
        why_selected.setdefault(sid, []).append(reason)

    # Assessment sessions are baseline anchors — mark them but exclude from delta calculations
    for fact in timeline.sessions:
        if fact.session_type == "assessment":
            _add_salient(fact.session_id, "assessment session (baseline anchor — excluded from delta calculations)")

    # Only non-assessment sessions feed the trend/delta analysis
    trend_sessions = [f for f in timeline.sessions if f.session_type != "assessment"]

    # Build metric time series: {metric_name: [(session_id, value), ...]}
    metric_series: dict[str, list[tuple[str, float]]] = {
        "fall_risk_score": [],
        "reinjury_risk_score": [],
        "pain_score": [],
        "rom_score": [],
    }
    for fact in trend_sessions:
        for metric in metric_series:
            val = fact.scores.get(metric)
            if val is not None:
                metric_series[metric].append((fact.session_id, val))

    # Per-joint ROM series (trend sessions only)
    joint_series: dict[str, list[tuple[str, float]]] = {}
    for fact in trend_sessions:
        for joint, rom_val in fact.injured_joint_rom.items():
            joint_series.setdefault(joint, []).append((fact.session_id, rom_val))

    def _analyze_series(series: list[tuple[str, float]], metric_name: str) -> None:
        if len(series) < 2:
            return
        values = [v for _, v in series]
        s_ids = [sid for sid, _ in series]
        score_range = max(values) - min(values)
        if score_range == 0:
            return
        threshold = 0.20 * score_range

        # Identify salient deltas
        salient_sids: list[str] = []
        for i in range(1, len(values)):
            delta = values[i] - values[i - 1]
            if abs(delta) >= threshold:
                direction_str = "increased" if delta > 0 else "decreased"
                _add_salient(s_ids[i], f"{metric_name} {direction_str} by {abs(round(delta, 2))} (threshold {round(threshold, 2)})")
                salient_sids.append(s_ids[i])

        # Detect sustained trend (≥3 consecutive same-direction deltas)
        consecutive = 0
        direction: str | None = None
        for i in range(1, len(values)):
            delta = values[i] - values[i - 1]
            if delta >= threshold:
                consecutive = (consecutive + 1) if direction == "up" else 1
                direction = "up"
            elif delta <= -threshold:
                consecutive = (consecutive + 1) if direction == "down" else 1
                direction = "down"
            else:
                consecutive = 0
                direction = None

        trend_label = None
        if consecutive >= 2 and direction:
            trend_label = "improving" if direction == "up" else "worsening"

        if salient_sids or trend_label:
            salient_metrics[metric_name] = {
                "direction": trend_label or ("improving" if values[-1] > values[0] else "worsening"),
                "values": [(sid, round(v, 2)) for sid, v in series],
                "delta_vs_baseline": round(values[-1] - values[0], 2),
                "session_ids": salient_sids,
                "score_range": round(score_range, 2),
            }

    for metric_name, series in metric_series.items():
        _analyze_series(series, metric_name)

    for joint_name, series in joint_series.items():
        _analyze_series(series, f"joint_rom_{joint_name}")

    # Always include the most recent session
    if timeline.sessions:
        _add_salient(timeline.sessions[-1].session_id, "most recent session")

    # Data warnings
    for fact in timeline.sessions:
        if fact.session_id in salient_session_ids:
            if not fact.data_sufficient:
                data_warnings.append(
                    f"Session {fact.session_id[:8]}: reinjury trend data insufficient (<3 sessions with joint ROM)"
                )
            if not fact.reporter_summary:
                data_warnings.append(f"Session {fact.session_id[:8]}: no reporter summary available")

    salient_summaries = [
        fact.reporter_summary
        for fact in timeline.sessions
        if fact.session_id in salient_session_ids and fact.reporter_summary
    ]

    return SalienceReport(
        salient_session_ids=salient_session_ids,
        salient_metrics=salient_metrics,
        salient_summaries=salient_summaries,
        data_warnings=data_warnings,
        why_selected={sid: "; ".join(reasons) for sid, reasons in why_selected.items()},
    )
