import json
import logging
import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uagents import Agent, Context

from agents._client import openai_client as _client, OPENAI_MODEL as _MODEL
from agents.hipaa import hipaa_wrap
from agents.messages import FallRiskRequest, FallRiskResponse
from db.models import Patient, SessionScore
from rag.retriever import retrieve_clinical_context
from schemas.session import FallRiskOutput, IntakeOutput, PoseAnalysisOutput
from utils.artifacts import get_artifact_id, write_artifact
from utils.audit import write_audit

logger = logging.getLogger(__name__)


async def run_fall_risk(
    intake: IntakeOutput,
    pose: PoseAnalysisOutput,
    patient_id: str,
    session_id: str,
    db: AsyncSession,
) -> FallRiskOutput:
    # Read patient demographic risk fields
    patient_result = await db.execute(select(Patient).where(Patient.id == patient_id))
    patient = patient_result.scalars().first()
    meta: dict = (patient.metadata_json or {}) if patient else {}
    demographic_risk_score: float | None = meta.get("demographicRiskScore")
    age: int | None = meta.get("age")
    bmi: float | None = meta.get("bmi")
    gender: str | None = meta.get("gender")

    rag_query = (
        f"fall risk assessment {' '.join(pose.flagged_joints)} "
        f"pain {json.dumps(intake.normalized_pain_scores)} "
        f"{intake.rehab_phase} {intake.injured_side}"
    )
    rag_result = await retrieve_clinical_context(rag_query)

    clinical_block = (
        f"Clinical guidelines:\n{rag_result.context}"
        if rag_result.hit_count > 0
        else "No clinical guidelines available for this query."
    )

    # Build clinical context block from intake enrichment
    intake_clinical = []
    if intake.injured_joints:
        intake_clinical.append(f"Injured joints: {', '.join(intake.injured_joints)}")
    if intake.injured_side != "unknown":
        intake_clinical.append(f"Injured side: {intake.injured_side}")
    if intake.rehab_phase != "unknown":
        intake_clinical.append(f"Rehab phase: {intake.rehab_phase}")
    if intake.contraindications:
        intake_clinical.append(f"Contraindications: {', '.join(intake.contraindications)}")
    clinical_intake_block = "\n".join(intake_clinical) if intake_clinical else "No clinical context available."

    demo_parts = []
    if demographic_risk_score is not None:
        demo_parts.append(f"Demographic risk score (mobile-computed): {demographic_risk_score:.1f}/100")
    if age is not None:
        demo_parts.append(f"Age: {age}")
    if bmi is not None:
        demo_parts.append(f"BMI: {bmi:.1f}")
    if gender:
        demo_parts.append(f"Gender: {gender}")
    demographic_block = "\n".join(demo_parts) if demo_parts else "No demographic data available."

    prompt = f"""Patient demographic profile:
{demographic_block}

Patient clinical context:
{clinical_intake_block}

Intake Data:
Target joints: {intake.target_joints}
Pain scores: {json.dumps(intake.normalized_pain_scores)}
Session goals: {intake.session_goals}

Pose Analysis:
ROM score: {pose.rom_score}
Flagged joints (low ROM or movement errors): {pose.flagged_joints}
Frame count: {pose.frame_count}
Joint stats: {json.dumps(pose.joint_stats, indent=2)}

{clinical_block}

Assess fall risk. Ground your assessment in the measurements above.
Return a JSON object with exactly:
{{
  "score": <float 0-100>,
  "risk_level": "<low|medium|high>",
  "reasoning": "<clinical reasoning citing specific measurements>",
  "contributing_factors": ["factor1", "factor2"]
}}
Output only valid JSON."""

    response = await _client.chat.completions.create(
        model=_MODEL,
        max_tokens=1024,
        messages=[
            {"role": "system", "content": "You are a clinical fall risk assessor. Ground reasoning in measurements provided. Output only valid JSON."},
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

    output = FallRiskOutput(
        **data,
        rag_used=rag_result.hit_count > 0,
        rag_sources=rag_result.sources,
    )

    safe_reasoning = await hipaa_wrap(
        content=output.reasoning,
        actor="fall_risk_agent",
        patient_id=patient_id,
        data_type="fall_risk_output",
        db=db,
    )
    output.reasoning = safe_reasoning

    # Persist SessionScore
    result = await db.execute(select(SessionScore).where(SessionScore.session_id == session_id))
    score_row = result.scalars().first()
    if score_row:
        score_row.fall_risk_score = output.score
    else:
        score_row = SessionScore(
            id=str(uuid.uuid4()),
            session_id=session_id,
            fall_risk_score=output.score,
            created_at=datetime.utcnow(),
        )
        db.add(score_row)
    await db.flush()

    # Collect upstream artifact IDs
    upstream = []
    for agent_name in ("intake_agent", "pose_analysis_agent"):
        aid = await get_artifact_id(session_id, agent_name, db)
        if aid:
            upstream.append(aid)

    coverage_notes = []
    if not rag_result.hit_count:
        coverage_notes.append("no guideline context retrieved")

    await write_artifact(
        agent_name="fall_risk_agent",
        session_id=session_id,
        patient_id=patient_id,
        artifact_kind="fall_risk_output",
        artifact_json={
            "metrics": {
                "score": output.score,
                "risk_level": output.risk_level,
                "contributing_factors": output.contributing_factors,
                "rag_used": output.rag_used,
                "rag_sources": output.rag_sources,
            }
        },
        upstream_artifact_ids=upstream,
        data_coverage={
            "required_fields_present": True,
            "missing_fields": [],
            "notes": coverage_notes,
        },
        db=db,
    )

    await write_audit("fall_risk_agent", "assess_fall_risk", patient_id, "fall_risk_score", db)
    return output


fall_risk_agent = Agent(name="fall-risk-agent", seed="physio-fall-risk-agent-sentinel-v1")


@fall_risk_agent.on_message(model=FallRiskRequest)
async def _handle_fall_risk(ctx: Context, sender: str, msg: FallRiskRequest):
    from db.session import AsyncSessionLocal
    try:
        async with AsyncSessionLocal() as db:
            intake = IntakeOutput(**msg.intake)
            pose = PoseAnalysisOutput(**msg.pose)
            output = await run_fall_risk(intake, pose, msg.patient_id, msg.session_id, db)
            await db.commit()
            await ctx.send(sender, FallRiskResponse(
                session_id=msg.session_id, **output.model_dump()
            ))
    except Exception as e:
        logger.error("fall_risk uagent error: %s", e)
        await ctx.send(sender, FallRiskResponse(
            session_id=msg.session_id,
            score=0.0, risk_level="unknown", reasoning="", contributing_factors=[],
            error=str(e),
        ))
