import json
import logging
import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uagents import Agent, Context

from agents._client import openai_client as _client, OPENAI_MODEL as _MODEL
from agents.hipaa import hipaa_wrap
from agents.messages import ReporterRequest, ReporterResponse
from db.models import Session, SessionScore, Summary
from schemas.session import FallRiskOutput, IntakeOutput, PoseAnalysisOutput, ReinjuryRiskOutput, ReporterOutput
from utils.artifacts import get_artifact_id, write_artifact
from utils.audit import write_audit

logger = logging.getLogger(__name__)


async def run_reporter(
    session_id: str,
    patient_id: str,
    intake: IntakeOutput,
    pose: PoseAnalysisOutput,
    fall_risk: FallRiskOutput,
    reinjury_risk: ReinjuryRiskOutput,
    db: AsyncSession,
) -> ReporterOutput:
    result = await db.execute(
        select(Summary)
        .join(Session, Summary.session_id == Session.id)
        .where(Summary.agent_name == "reporter", Session.patient_id == patient_id)
        .order_by(Summary.created_at.desc())
        .limit(3)
    )
    past_summaries = result.scalars().all()
    past_text = "\n\n---\n\n".join(s.content for s in past_summaries) if past_summaries else "No previous summaries."

    clinical_context = []
    if intake.injured_joints:
        clinical_context.append(f"Injured joints: {', '.join(intake.injured_joints)}")
    if intake.rehab_phase != "unknown":
        clinical_context.append(f"Rehab phase: {intake.rehab_phase}")
    if intake.injured_side != "unknown":
        clinical_context.append(f"Injured side: {intake.injured_side}")
    if intake.contraindications:
        clinical_context.append(f"Contraindications: {', '.join(intake.contraindications)}")
    clinical_block = "\n".join(clinical_context) if clinical_context else "No clinical context available."

    reinjury_trend_block = ""
    if reinjury_risk.injured_joint_trend:
        reinjury_trend_block = f"\nPer-joint ROM trends:\n{json.dumps(reinjury_risk.injured_joint_trend, indent=2)}"
    if not reinjury_risk.data_sufficient:
        reinjury_trend_block += "\n(Note: reinjury trend data insufficient — < 3 sessions with joint ROM)"

    prompt = f"""Session type: {intake.session_type}
Clinical context: {clinical_block}

Session Data:
Target joints: {intake.target_joints}
Pain scores: {json.dumps(intake.normalized_pain_scores)}
Session goals: {intake.session_goals}
ROM score: {pose.rom_score} / 100
Flagged joints: {pose.flagged_joints}
Frame count: {pose.frame_count}

Fall risk: {fall_risk.score} ({fall_risk.risk_level})
Contributing factors: {fall_risk.contributing_factors}
RAG guidelines used: {fall_risk.rag_used}

Reinjury risk: {reinjury_risk.score} (trend: {reinjury_risk.trend}, data sufficient: {reinjury_risk.data_sufficient}){reinjury_trend_block}

Previous summaries for context:
{past_text}

Write a structured clinical summary grounded in the measurements above.
For an "assessment" session, emphasise baseline measurements.
Do not include patient names or identifiers.
Return a JSON object with exactly:
{{
  "summary": "<full clinical summary paragraph>",
  "session_highlights": ["highlight1", "highlight2"],
  "recommendations": ["recommendation1", "recommendation2"],
  "evidence_map": {{
    "fall_risk_section": ["<metric=value that drove this section>"],
    "reinjury_risk_section": ["<metric=value>"],
    "recommendations_section": ["<metric=value>"]
  }}
}}
Output only valid JSON."""

    response = await _client.chat.completions.create(
        model=_MODEL,
        max_tokens=1500,
        messages=[
            {"role": "system", "content": "You are a physical therapy session reporter. Write structured clinical summaries grounded in measurements. Output only valid JSON."},
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

    evidence_map = data.get("evidence_map", {})
    output = ReporterOutput(
        summary=data["summary"],
        session_highlights=data["session_highlights"],
        recommendations=data["recommendations"],
        evidence_map=evidence_map,
    )

    await hipaa_wrap(
        content=json.dumps(data),
        actor="reporter_agent",
        patient_id=patient_id,
        data_type="reporter_output",
        db=db,
    )

    summary_row = Summary(
        id=str(uuid.uuid4()),
        session_id=session_id,
        agent_name="reporter",
        content=output.summary,
        created_at=datetime.utcnow(),
    )
    db.add(summary_row)

    score_result = await db.execute(select(SessionScore).where(SessionScore.session_id == session_id))
    score_row = score_result.scalars().first()
    pain_avg = (
        sum(intake.normalized_pain_scores.values()) / len(intake.normalized_pain_scores)
        if intake.normalized_pain_scores else 0.0
    )

    if score_row:
        score_row.pain_score = pain_avg
        score_row.rom_score = pose.rom_score
    else:
        db.add(SessionScore(
            id=str(uuid.uuid4()),
            session_id=session_id,
            pain_score=pain_avg,
            rom_score=pose.rom_score,
            created_at=datetime.utcnow(),
        ))
    await db.flush()

    # Collect upstream artifact IDs
    upstream = []
    for agent_name in ("fall_risk_agent", "reinjury_risk_agent"):
        aid = await get_artifact_id(session_id, agent_name, db)
        if aid:
            upstream.append(aid)

    await write_artifact(
        agent_name="reporter_agent",
        session_id=session_id,
        patient_id=patient_id,
        artifact_kind="reporter_output",
        artifact_json={
            "metrics": {
                "session_id": session_id,
                "summary": output.summary,
                "session_highlights": output.session_highlights,
                "recommendations": output.recommendations,
                "fall_risk_score": fall_risk.score,
                "reinjury_risk_score": reinjury_risk.score,
                "rom_score": pose.rom_score,
                "pain_avg": round(pain_avg, 2),
                "evidence_map": evidence_map,
                "reportability": "reportable",
            }
        },
        upstream_artifact_ids=upstream,
        data_coverage={
            "required_fields_present": True,
            "missing_fields": [],
            "notes": [] if reinjury_risk.data_sufficient else ["reinjury trend data insufficient"],
        },
        db=db,
    )

    await write_audit("reporter_agent", "generate_report", patient_id, "session_report", db)
    return output


reporter_agent = Agent(name="reporter-agent", seed="physio-reporter-agent-sentinel-v1")


@reporter_agent.on_message(model=ReporterRequest)
async def _handle_reporter(ctx: Context, sender: str, msg: ReporterRequest):
    from db.session import AsyncSessionLocal
    try:
        async with AsyncSessionLocal() as db:
            output = await run_reporter(
                msg.session_id, msg.patient_id,
                IntakeOutput(**msg.intake),
                PoseAnalysisOutput(**msg.pose),
                FallRiskOutput(**msg.fall_risk),
                ReinjuryRiskOutput(**msg.reinjury_risk),
                db,
            )
            await db.commit()
            await ctx.send(sender, ReporterResponse(
                session_id=msg.session_id, **output.model_dump()
            ))
    except Exception as e:
        logger.error("reporter uagent error: %s", e)
        await ctx.send(sender, ReporterResponse(
            session_id=msg.session_id,
            summary="", session_highlights=[], recommendations=[],
            error=str(e),
        ))
