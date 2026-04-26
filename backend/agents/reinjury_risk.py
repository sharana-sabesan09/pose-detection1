import json
import logging
import statistics
import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uagents import Agent, Context

from agents._client import openai_client as _client, OPENAI_MODEL as _MODEL
from agents.hipaa import hipaa_wrap
from agents.messages import ReinjuryRiskRequest, ReinjuryRiskResponse
from db.models import AgentArtifact, ExerciseSession, Patient, RepAnalysis, Session, SessionScore
from schemas.session import PoseAnalysisOutput, ReinjuryRiskOutput
from utils.artifacts import get_artifact_id, write_artifact
from utils.audit import write_audit

logger = logging.getLogger(__name__)

# Static lookup: injured joint keyword → RepAnalysis columns to read
_JOINT_TO_REP_FEATURES: dict[str, list[str]] = {
    "knee": ["knee_flexion_deg", "fppa_peak", "rom_ratio"],
    "hip": ["hip_adduction_peak", "pelvic_drop_peak"],
    # ankle and shoulder: use ROM from pose artifacts only (no dedicated RepAnalysis columns)
}


def _match_rep_features(joint_name: str) -> list[str]:
    joint_lower = joint_name.lower()
    for key, features in _JOINT_TO_REP_FEATURES.items():
        if key in joint_lower:
            return features
    return []


def _compute_trend(rom_values: list[float]) -> str:
    """Determine trend direction using relative 20% threshold. Requires >= 3 values."""
    if len(rom_values) < 3:
        return "unknown"
    score_range = max(rom_values) - min(rom_values)
    if score_range == 0:
        return "stable"
    threshold = 0.20 * score_range
    consecutive = 0
    direction: str | None = None
    for i in range(1, len(rom_values)):
        delta = rom_values[i] - rom_values[i - 1]
        if delta >= threshold:
            if direction == "improving":
                consecutive += 1
            else:
                direction = "improving"
                consecutive = 1
        elif delta <= -threshold:
            if direction == "worsening":
                consecutive += 1
            else:
                direction = "worsening"
                consecutive = 1
        else:
            consecutive = 0
            direction = None
        if consecutive >= 2:  # 3 sessions = 2 consecutive same-direction transitions
            return direction
    return "stable"


async def _get_injured_joints(patient_id: str, db: AsyncSession) -> list[str]:
    """Return injured_joints from metadata_json, or fall back to union of flagged_joints."""
    patient_result = await db.execute(select(Patient).where(Patient.id == patient_id))
    patient = patient_result.scalars().first()
    if patient and patient.metadata_json:
        joints = patient.metadata_json.get("injured_joints", [])
        if joints:
            return joints

    # Fallback: union of flagged_joints from last 3 pose artifacts
    artifacts_result = await db.execute(
        select(AgentArtifact)
        .where(
            AgentArtifact.patient_id == patient_id,
            AgentArtifact.agent_name == "pose_analysis_agent",
        )
        .order_by(AgentArtifact.created_at.desc())
        .limit(3)
    )
    artifacts = artifacts_result.scalars().all()
    joint_union: list[str] = []
    for art in artifacts:
        flagged = art.artifact_json.get("metrics", {}).get("flagged_joints", [])
        for j in flagged:
            if j not in joint_union:
                joint_union.append(j)
    return joint_union


async def run_reinjury_risk(
    patient_id: str,
    session_id: str,
    pose: PoseAnalysisOutput,
    db: AsyncSession,
) -> ReinjuryRiskOutput:
    # ── Query 1: per-joint ROM from last 5 pose artifacts ──────────────────────
    injured_joints = await _get_injured_joints(patient_id, db)

    pose_artifacts_result = await db.execute(
        select(AgentArtifact)
        .where(
            AgentArtifact.patient_id == patient_id,
            AgentArtifact.agent_name == "pose_analysis_agent",
        )
        .order_by(AgentArtifact.created_at.asc())
        .limit(5)
    )
    pose_artifacts = pose_artifacts_result.scalars().all()

    # Build per-joint ROM history (chronological)
    joint_rom_history: dict[str, list[float]] = {}
    pose_artifact_ids: list[str] = []
    for art in pose_artifacts:
        pose_artifact_ids.append(art.id)
        joint_stats = art.artifact_json.get("metrics", {}).get("joint_stats", {})
        for joint in injured_joints:
            if joint in joint_stats and "rom" in joint_stats[joint]:
                joint_rom_history.setdefault(joint, []).append(joint_stats[joint]["rom"])

    # ── Query 2: RepAnalysis rows for exercise sessions ────────────────────────
    rep_feature_context: dict[str, dict] = {}
    if injured_joints:
        ex_sessions_result = await db.execute(
            select(ExerciseSession)
            .where(ExerciseSession.patient_id == patient_id)
            .order_by(ExerciseSession.created_at.desc())
            .limit(5)
        )
        ex_sessions = ex_sessions_result.scalars().all()

        for ex_session in ex_sessions:
            reps_result = await db.execute(
                select(RepAnalysis).where(RepAnalysis.exercise_session_id == ex_session.id)
            )
            reps = reps_result.scalars().all()
            if not reps:
                continue

            for joint in injured_joints:
                features = _match_rep_features(joint)
                if not features:
                    continue
                for feat in features:
                    vals = [getattr(r, feat) for r in reps if getattr(r, feat) is not None]
                    if vals:
                        rep_feature_context.setdefault(joint, {})[feat] = round(statistics.mean(vals), 3)

    # ── Query 3: SessionScore aggregate (unchanged fallback) ──────────────────
    scores_result = await db.execute(
        select(SessionScore)
        .join(Session, SessionScore.session_id == Session.id)
        .where(Session.patient_id == patient_id)
        .order_by(SessionScore.created_at.asc())
        .limit(5)
    )
    recent_scores = scores_result.scalars().all()
    fall_trend = [s.fall_risk_score for s in recent_scores if s.fall_risk_score is not None]
    rom_trend = [s.rom_score for s in recent_scores if s.rom_score is not None]

    # ── Compute injured_joint_trend deterministically ──────────────────────────
    injured_joint_trend: dict = {}
    sessions_with_data = 0

    for joint, rom_values in joint_rom_history.items():
        sessions_with_data = max(sessions_with_data, len(rom_values))
        if len(rom_values) < 2:
            continue
        trend_dir = _compute_trend(rom_values)
        score_range = max(rom_values) - min(rom_values)
        injured_joint_trend[joint] = {
            "direction": trend_dir,
            "rom_values": [round(v, 2) for v in rom_values],
            "delta_vs_earliest": round(rom_values[-1] - rom_values[0], 2),
            "range_pct_delta": round(abs(rom_values[-1] - rom_values[0]) / score_range if score_range > 0 else 0.0, 3),
        }

    data_sufficient = sessions_with_data >= 3

    # ── LLM call ──────────────────────────────────────────────────────────────
    joint_trend_text = json.dumps(injured_joint_trend, indent=2) if injured_joint_trend else "No per-joint ROM history available yet."
    rep_feat_text = json.dumps(rep_feature_context, indent=2) if rep_feature_context else "No exercise rep data available."

    prompt = f"""Patient trend data (most recent to oldest where listed):
Fall risk scores: {fall_trend}
ROM scores (aggregate): {rom_trend}

Per-joint ROM trend (chronological):
{joint_trend_text}

Exercise session biomechanical features (mean per injured joint):
{rep_feat_text}

Current session:
ROM score: {pose.rom_score}
Flagged joints: {pose.flagged_joints}
Data sufficient (≥3 sessions with joint ROM): {data_sufficient}

Injured joints tracked: {injured_joints or 'not specified — trend based on flagged joints'}

Assess reinjury risk grounded in the data above.
Return a JSON object with exactly:
{{
  "score": <float 0-100>,
  "trend": "<improving|stable|worsening>",
  "reasoning": "<clinical reasoning citing specific joint trends and measurements>"
}}
Output only valid JSON."""

    response = await _client.chat.completions.create(
        model=_MODEL,
        max_tokens=512,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = response.choices[0].message.content.strip()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}") + 1
        data = json.loads(raw[start:end])

    output = ReinjuryRiskOutput(
        score=data["score"],
        trend=data["trend"],
        reasoning=data["reasoning"],
        sessions_used=sessions_with_data,
        data_sufficient=data_sufficient,
        injured_joint_trend=injured_joint_trend,
    )

    safe_reasoning = await hipaa_wrap(
        content=output.reasoning,
        actor="reinjury_risk_agent",
        patient_id=patient_id,
        data_type="reinjury_risk_output",
        db=db,
    )
    output.reasoning = safe_reasoning

    # Persist SessionScore
    score_result = await db.execute(select(SessionScore).where(SessionScore.session_id == session_id))
    score_row = score_result.scalars().first()
    if score_row:
        score_row.reinjury_risk_score = output.score
    else:
        db.add(SessionScore(
            id=str(uuid.uuid4()),
            session_id=session_id,
            reinjury_risk_score=output.score,
            created_at=datetime.utcnow(),
        ))
    await db.flush()

    coverage_notes = []
    if not data_sufficient:
        coverage_notes.append(f"only {sessions_with_data} session(s) with joint ROM data — trend unreliable")
    if not injured_joints:
        coverage_notes.append("injured_joints not in patient metadata — fell back to flagged joints")

    await write_artifact(
        agent_name="reinjury_risk_agent",
        session_id=session_id,
        patient_id=patient_id,
        artifact_kind="reinjury_risk_output",
        artifact_json={
            "metrics": {
                "score": output.score,
                "trend": output.trend,
                "sessions_used": sessions_with_data,
                "data_sufficient": data_sufficient,
                "injured_joint_trend": injured_joint_trend,
            }
        },
        upstream_artifact_ids=pose_artifact_ids,
        data_coverage={
            "required_fields_present": data_sufficient,
            "missing_fields": [] if injured_joints else ["injured_joints"],
            "notes": coverage_notes,
        },
        db=db,
    )

    await write_audit("reinjury_risk_agent", "assess_reinjury_risk", patient_id, "reinjury_risk_score", db)
    return output


reinjury_agent = Agent(name="reinjury-risk-agent", seed="physio-reinjury-risk-agent-sentinel-v1")


@reinjury_agent.on_message(model=ReinjuryRiskRequest)
async def _handle_reinjury_risk(ctx: Context, sender: str, msg: ReinjuryRiskRequest):
    from db.session import AsyncSessionLocal
    try:
        async with AsyncSessionLocal() as db:
            pose = PoseAnalysisOutput(**msg.pose)
            output = await run_reinjury_risk(msg.patient_id, msg.session_id, pose, db)
            await db.commit()
            await ctx.send(sender, ReinjuryRiskResponse(
                session_id=msg.session_id, **output.model_dump()
            ))
    except Exception as e:
        logger.error("reinjury_risk uagent error: %s", e)
        await ctx.send(sender, ReinjuryRiskResponse(
            session_id=msg.session_id,
            score=0.0, trend="unknown", reasoning="",
            error=str(e),
        ))
