import json
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uagents import Agent, Context

from agents._client import openai_client as _client, OPENAI_MODEL as _MODEL
from agents.hipaa import hipaa_wrap
from agents.messages import IntakeRequest, IntakeResponse
from db.models import Patient
from schemas.session import IntakeInput, IntakeOutput
from utils.artifacts import write_artifact
from utils.audit import write_audit

logger = logging.getLogger(__name__)


async def run_intake(intake: IntakeInput, db: AsyncSession) -> IntakeOutput:
    # Load patient clinical metadata (Phase 4 enrichment)
    patient_result = await db.execute(select(Patient).where(Patient.id == intake.patient_id))
    patient = patient_result.scalars().first()
    meta: dict = (patient.metadata_json or {}) if patient else {}

    injured_joints: list[str] = meta.get("injured_joints", [])
    injured_side: str = meta.get("injured_side", "unknown")
    rehab_phase: str = meta.get("rehab_phase", "unknown")
    diagnosis: str = meta.get("diagnosis", "")
    contraindications: list[str] = meta.get("contraindications", [])
    restrictions: list[str] = meta.get("restrictions", [])

    # Determine data confidence
    if injured_joints or rehab_phase not in ("unknown", ""):
        data_confidence = "explicit"
    elif intake.pt_plan.strip():
        data_confidence = "inferred"
    else:
        data_confidence = "missing"

    clinical_context_lines = []
    if diagnosis:
        clinical_context_lines.append(f"Diagnosis: {diagnosis}")
    if injured_joints:
        clinical_context_lines.append(f"Injured joints: {', '.join(injured_joints)}")
    if injured_side != "unknown":
        clinical_context_lines.append(f"Injured side: {injured_side}")
    if rehab_phase != "unknown":
        clinical_context_lines.append(f"Rehab phase: {rehab_phase}")
    if contraindications:
        clinical_context_lines.append(f"Contraindications: {', '.join(contraindications)}")
    if restrictions:
        clinical_context_lines.append(f"Restrictions: {', '.join(restrictions)}")

    clinical_block = "\n".join(clinical_context_lines) if clinical_context_lines else "No clinical context available."

    prompt = f"""Parse and normalize the following physical therapy intake data.

Clinical context (from patient record):
{clinical_block}

PT Plan: {intake.pt_plan}
Pain Scores: {json.dumps(intake.pain_scores)}
Patient Input: {intake.user_input}
Session type: {intake.session_type}

Return a JSON object with exactly these fields:
{{
  "normalized_pain_scores": {{"joint_name": score_0_to_10}},
  "target_joints": ["joint1", "joint2"],
  "session_goals": ["goal1", "goal2"]
}}
If clinical context is provided, use it to anchor target_joints to clinically relevant joints.
Output only valid JSON, no prose."""

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

    output = IntakeOutput(
        normalized_pain_scores=data["normalized_pain_scores"],
        target_joints=data["target_joints"],
        session_goals=data["session_goals"],
        session_type=intake.session_type,
        injured_joints=injured_joints,
        injured_side=injured_side,
        rehab_phase=rehab_phase,
        contraindications=contraindications,
        data_confidence=data_confidence,
    )

    await hipaa_wrap(
        content=json.dumps(data),
        actor="intake_agent",
        patient_id=intake.patient_id,
        data_type="intake_output",
        db=db,
    )

    missing_fields = []
    if not injured_joints:
        missing_fields.append("injured_joints")
    if rehab_phase == "unknown":
        missing_fields.append("rehab_phase")
    if not diagnosis:
        missing_fields.append("diagnosis")

    await write_artifact(
        agent_name="intake_agent",
        session_id=intake.session_id,
        patient_id=intake.patient_id,
        artifact_kind="intake_output",
        artifact_json={
            "metrics": {
                "pain_scores": output.normalized_pain_scores,
                "target_joint_count": len(output.target_joints),
                "injured_joints": injured_joints,
                "injured_side": injured_side,
                "rehab_phase": rehab_phase,
                "contraindications": contraindications,
                "data_confidence": data_confidence,
                "session_type": output.session_type,
            }
        },
        upstream_artifact_ids=[],
        data_coverage={
            "required_fields_present": data_confidence == "explicit",
            "missing_fields": missing_fields,
            "notes": [] if data_confidence == "explicit" else [f"data_confidence={data_confidence}"],
        },
        db=db,
    )

    await write_audit("intake_agent", "normalize_intake", intake.patient_id, "intake_output", db)
    return output


intake_agent = Agent(name="intake-agent", seed="physio-intake-agent-sentinel-v1")


@intake_agent.on_message(model=IntakeRequest)
async def _handle_intake(ctx: Context, sender: str, msg: IntakeRequest):
    from db.session import AsyncSessionLocal
    try:
        async with AsyncSessionLocal() as db:
            output = await run_intake(IntakeInput(
                session_id=msg.session_id,
                patient_id=msg.patient_id,
                pt_plan=msg.pt_plan,
                pain_scores=msg.pain_scores,
                user_input=msg.user_input,
                session_type=msg.session_type,
            ), db)
            await db.commit()
            await ctx.send(sender, IntakeResponse(
                session_id=msg.session_id,
                **output.model_dump(),
            ))
    except Exception as e:
        logger.error("intake uagent error: %s", e)
        await ctx.send(sender, IntakeResponse(
            session_id=msg.session_id,
            normalized_pain_scores={}, target_joints=[], session_goals=[],
            error=str(e),
        ))
