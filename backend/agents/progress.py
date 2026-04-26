import json
import logging
import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uagents import Agent, Context

from agents._client import openai_client as _client, OPENAI_MODEL as _MODEL
from agents.hipaa import hipaa_wrap
from agents.messages import ProgressRequest, ProgressResponse
from agents.progress_salience import build_patient_timeline, compute_salience
from db.models import AccumulatedScore, Session as SessionModel, SessionScore, Summary
from schemas.session import ProgressOutput
from utils.artifacts import write_artifact
from utils.audit import write_audit

logger = logging.getLogger(__name__)


def _weighted_average(scores: list[SessionScore], field_name: str) -> float | None:
    weighted_values = [
        (getattr(score, field_name), 1.0 / (i + 1))
        for i, score in enumerate(scores)
        if getattr(score, field_name) is not None
    ]
    if not weighted_values:
        return None
    total_weight = sum(weight for _, weight in weighted_values)
    return sum(value * weight for value, weight in weighted_values) / total_weight


async def run_progress(patient_id: str, db: AsyncSession) -> ProgressOutput:
    # ── Layer 1: Build structured patient timeline ────────────────────────────
    timeline = await build_patient_timeline(patient_id, db)
    if len(timeline.sessions) < 3:
        output = ProgressOutput(
            longitudinal_report=(
                "Insufficient longitudinal data to generate a grounded progress report. "
                "At least 3 recorded sessions are required before trend analysis is shown."
            ),
            overall_trend="insufficient_data",
            milestones_reached=[],
            next_goals=[],
            evidence_citations={},
            data_warnings=[
                f"Only {len(timeline.sessions)} recorded session(s) available; at least 3 are required.",
            ],
        )
        await hipaa_wrap(
            content=json.dumps(output.model_dump()),
            actor="progress_agent",
            patient_id=patient_id,
            data_type="progress_output",
            db=db,
        )
        await write_artifact(
            agent_name="progress_agent",
            session_id=None,
            patient_id=patient_id,
            artifact_kind="progress_output",
            artifact_json={
                "metrics": {
                    "longitudinal_report": output.longitudinal_report,
                    "overall_trend": output.overall_trend,
                    "milestones_reached": output.milestones_reached,
                    "next_goals": output.next_goals,
                    "evidence_citations": output.evidence_citations,
                    "data_warnings": output.data_warnings,
                    "salient_session_ids": [],
                    "metrics_used": {},
                }
            },
            upstream_artifact_ids=[],
            data_coverage={
                "required_fields_present": False,
                "missing_fields": ["minimum_session_count"],
                "notes": output.data_warnings,
            },
            db=db,
        )
        await write_audit(
            "progress_agent",
            "generate_progress_report",
            patient_id,
            "progress_output",
            db,
        )
        return output

    # ── Layer 2: Compute salience deterministically ───────────────────────────
    salience = compute_salience(timeline)

    # ── Layer 3: Constrained LLM call with SalienceReport only ───────────────
    prompt_parts = [
        f"Patient rehab phase: {timeline.rehab_phase}",
        f"Injured joints: {', '.join(timeline.injured_joints) or 'not specified'}",
        "",
        "Salient metric trends (only metrics with ≥20% relative change are listed):",
        json.dumps(salience.salient_metrics, indent=2),
        "",
        "Evidence for salient sessions:",
        json.dumps(salience.why_selected, indent=2),
        "",
        "Session summaries for salient sessions:",
    ]
    for i, summary in enumerate(salience.salient_summaries):
        prompt_parts.append(f"[Summary {i + 1}]\n{summary}")

    if salience.data_warnings:
        prompt_parts += ["", "Data warnings — acknowledge each in your report:"]
        prompt_parts.extend(f"  - {w}" for w in salience.data_warnings)

    prompt_parts += [
        "",
        "Write a longitudinal progress report grounded ONLY in the evidence above.",
        "Rules:",
        "  - Cite only session IDs and metrics present in the data",
        "  - Do not infer causes not in the data",
        "  - Explicitly acknowledge any data warnings",
        "  - Do not include patient names or identifiers",
        "",
        "Return a JSON object with exactly:",
        """{
  "longitudinal_report": "<full longitudinal analysis>",
  "overall_trend": "<improving|stable|declining>",
  "milestones_reached": ["milestone1"],
  "next_goals": ["goal1"],
  "evidence_citations": {
    "trend_section": ["session_id X: metric Y changed by Z"],
    "milestone_section": [],
    "recommendation_section": []
  }
}
Output only valid JSON.""",
    ]

    prompt = "\n".join(prompt_parts)

    response = await _client.chat.completions.create(
        model=_MODEL,
        max_tokens=1500,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a longitudinal physical therapy progress analyst. "
                    "Cite only evidence in the SalienceReport provided. "
                    "Do not invent or extrapolate. Output only valid JSON."
                ),
            },
            {"role": "user", "content": prompt},
        ],
    )
    raw = response.choices[0].message.content.strip()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}") + 1
        data = json.loads(raw[start:end])

    data.setdefault("data_warnings", salience.data_warnings)
    output = ProgressOutput(**data)

    await hipaa_wrap(
        content=json.dumps(data),
        actor="progress_agent",
        patient_id=patient_id,
        data_type="progress_output",
        db=db,
    )

    progress_row = Summary(
        id=str(uuid.uuid4()),
        session_id=None,
        agent_name="progress",
        content=output.longitudinal_report,
        created_at=datetime.utcnow(),
    )
    db.add(progress_row)

    # Recompute accumulated scores — weighted average of last 10 sessions
    scores_result = await db.execute(
        select(SessionScore)
        .join(SessionModel, SessionScore.session_id == SessionModel.id)
        .where(SessionModel.patient_id == patient_id)
        .order_by(SessionScore.created_at.desc())
        .limit(10)
    )
    recent_scores = scores_result.scalars().all()

    acc_result = await db.execute(
        select(AccumulatedScore).where(AccumulatedScore.patient_id == patient_id)
    )
    acc = acc_result.scalars().first()

    if recent_scores:
        fall_wavg = _weighted_average(recent_scores, "fall_risk_score")
        reinjury_wavg = _weighted_average(recent_scores, "reinjury_risk_score")
        if acc:
            acc.fall_risk_avg = fall_wavg
            acc.reinjury_risk_avg = reinjury_wavg
            acc.updated_at = datetime.utcnow()
        else:
            db.add(AccumulatedScore(
                id=str(uuid.uuid4()),
                patient_id=patient_id,
                fall_risk_avg=fall_wavg,
                reinjury_risk_avg=reinjury_wavg,
                updated_at=datetime.utcnow(),
            ))
    await db.flush()

    # ── Layer 4: Persist progress artifact with evidence ─────────────────────
    await write_artifact(
        agent_name="progress_agent",
        session_id=None,
        patient_id=patient_id,
        artifact_kind="progress_output",
        artifact_json={
            "metrics": {
                "longitudinal_report": output.longitudinal_report,
                "overall_trend": output.overall_trend,
                "milestones_reached": output.milestones_reached,
                "next_goals": output.next_goals,
                "evidence_citations": output.evidence_citations,
                "data_warnings": output.data_warnings,
                "salient_session_ids": salience.salient_session_ids,
                "salient_artifact_ids": salience.salient_artifact_ids,
                "metrics_used": salience.salient_metrics,
            }
        },
        upstream_artifact_ids=salience.salient_artifact_ids,
        data_coverage={
            "required_fields_present": bool(salience.salient_session_ids),
            "missing_fields": [] if salience.salient_artifact_ids or not salience.salient_session_ids else ["upstream_artifacts"],
            "notes": salience.data_warnings,
        },
        db=db,
    )

    await write_audit("progress_agent", "generate_progress_report", patient_id, "progress_output", db)
    return output


progress_agent = Agent(name="progress-agent", seed="physio-progress-agent-sentinel-v1")


@progress_agent.on_message(model=ProgressRequest)
async def _handle_progress(ctx: Context, sender: str, msg: ProgressRequest):
    from db.session import AsyncSessionLocal
    try:
        async with AsyncSessionLocal() as db:
            output = await run_progress(msg.patient_id, db)
            await db.commit()
            await ctx.send(sender, ProgressResponse(
                patient_id=msg.patient_id, **output.model_dump()
            ))
    except Exception as e:
        logger.error("progress uagent error: %s", e)
        await ctx.send(sender, ProgressResponse(
            patient_id=msg.patient_id,
            longitudinal_report="", overall_trend="unknown",
            milestones_reached=[], next_goals=[],
            error=str(e),
        ))
