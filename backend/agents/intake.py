import json
import logging
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession
from uagents import Agent, Context
from config import settings
from schemas.session import IntakeInput, IntakeOutput
from agents.hipaa import hipaa_wrap
from agents.messages import IntakeRequest, IntakeResponse
from utils.audit import write_audit

logger = logging.getLogger(__name__)

_client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
_MODEL = "gpt-4o"


async def run_intake(intake: IntakeInput, db: AsyncSession) -> IntakeOutput:
    prompt = f"""Parse and normalize the following physical therapy intake data.

PT Plan: {intake.pt_plan}
Pain Scores: {json.dumps(intake.pain_scores)}
Patient Input: {intake.user_input}

Return a JSON object with exactly these fields:
{{
  "normalized_pain_scores": {{"joint_name": score_0_to_10}},
  "target_joints": ["joint1", "joint2"],
  "session_goals": ["goal1", "goal2"]
}}
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

    output = IntakeOutput(**data)

    safe_json = await hipaa_wrap(
        content=json.dumps(data),
        actor="intake_agent",
        patient_id=intake.patient_id,
        data_type="intake_output",
        db=db,
    )

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
            ), db)
            await ctx.send(sender, IntakeResponse(
                session_id=msg.session_id, **output.model_dump()
            ))
    except Exception as e:
        logger.error("intake uagent error: %s", e)
        await ctx.send(sender, IntakeResponse(
            session_id=msg.session_id,
            normalized_pain_scores={}, target_joints=[], session_goals=[],
            error=str(e),
        ))
