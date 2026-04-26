import json
import logging
import os
import shlex
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from pydantic import BaseModel
from sqlalchemy import select
from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    StartSessionContent,
    TextContent,
    chat_protocol_spec,
)

from agents.patient_advisor import run_patient_advisor
from agents.progress import run_progress
from db.models import AgentArtifact, Session as SessionModel, Summary
from db.session import AsyncSessionLocal
from schemas.session import ProgressOutput, ReporterOutput

logger = logging.getLogger(__name__)


def _env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _agent_endpoint() -> list[str] | None:
    endpoint = os.getenv("ASI_ONE_AGENT_ENDPOINT", "").strip()
    if not endpoint:
        return None
    return [endpoint]


def _agent_seed() -> str:
    seed = os.getenv("ASI_ONE_AGENT_SEED", "").strip()
    if seed:
        return seed

    logger.warning("ASI_ONE_AGENT_SEED is not set; using a development seed.")
    return "sentinel-asi-one-chat-agent-dev-seed"


_README_PATH = Path(__file__).resolve().parents[1] / "ASI_ONE_AGENT.md"


sentinel_asi_one_agent = Agent(
    name=os.getenv("ASI_ONE_AGENT_NAME", "sentinel-rehab-chat"),
    seed=_agent_seed(),
    port=int(os.getenv("ASI_ONE_AGENT_PORT", "8001")),
    endpoint=_agent_endpoint(),
    mailbox=_env_flag("ASI_ONE_AGENT_USE_MAILBOX", default=False),
    handle=os.getenv("ASI_ONE_AGENT_HANDLE") or None,
    description=(
        os.getenv("ASI_ONE_AGENT_DESCRIPTION")
        or "Chat-protocol wrapper for the Sentinel physiotherapy backend."
    ),
    readme_path=str(_README_PATH) if _README_PATH.exists() else None,
    publish_agent_details=True,
)

chat_protocol = Protocol(spec=chat_protocol_spec)


def _create_text_chat(text: str, end_session: bool = True) -> ChatMessage:
    content = [TextContent(type="text", text=text)]
    if end_session:
        content.append(EndSessionContent(type="end-session"))

    return ChatMessage(
        timestamp=datetime.utcnow(),
        msg_id=uuid4(),
        content=content,
    )


HELP_TEXT = """Sentinel Rehab Assistant supports these commands:

- /latest_report patient_id=<patient-id>
- /progress patient_id=<patient-id>
- /advice patient_id=<patient-id> question="<question>"

JSON also works:
{"command":"advice","patient_id":"<patient-id>","question":"Can I increase squat depth this week?"}

Notes:
- /latest_report is read-only.
- /progress generates a fresh progress report using existing backend logic.
- /advice generates patient-specific guidance using existing backend logic.
"""


@dataclass(slots=True)
class CommandRequest:
    command: str
    patient_id: str | None = None
    question: str | None = None


class HealthResponse(BaseModel):
    status: str


def _collect_text(msg: ChatMessage) -> str:
    chunks: list[str] = []
    for item in msg.content:
        if isinstance(item, StartSessionContent):
            continue
        if isinstance(item, TextContent) and item.text.strip():
            chunks.append(item.text.strip())
    return "\n".join(chunks).strip()


def _normalize_command(name: str) -> str:
    key = name.strip().lower().lstrip("/")
    aliases = {
        "help": "help",
        "report": "latest_report",
        "latest-report": "latest_report",
        "latest_report": "latest_report",
        "progress": "progress",
        "refresh-progress": "progress",
        "refresh_progress": "progress",
        "advice": "advice",
    }
    return aliases.get(key, key)


def _parse_json_command(text: str) -> CommandRequest:
    data = json.loads(text)
    return CommandRequest(
        command=_normalize_command(str(data.get("command", ""))),
        patient_id=(str(data.get("patient_id", "")).strip() or None),
        question=(str(data.get("question", "")).strip() or None),
    )


def _parse_shell_command(text: str) -> CommandRequest:
    try:
        tokens = shlex.split(text)
    except ValueError as exc:
        raise ValueError(f"Invalid command syntax: {exc}") from exc

    if not tokens:
        raise ValueError("Empty command.")

    command = _normalize_command(tokens[0])
    if command == "help":
        return CommandRequest(command="help")

    params: dict[str, str] = {}
    trailing: list[str] = []
    for token in tokens[1:]:
        if "=" in token:
            key, value = token.split("=", 1)
            params[key.strip().lower()] = value.strip()
        else:
            trailing.append(token.strip())

    if command == "advice" and "question" not in params and trailing:
        params["question"] = " ".join(part for part in trailing if part)

    return CommandRequest(
        command=command,
        patient_id=(params.get("patient_id") or "").strip() or None,
        question=(params.get("question") or "").strip() or None,
    )


def _parse_request(text: str) -> CommandRequest:
    stripped = text.strip()
    if not stripped:
        return CommandRequest(command="help")
    if stripped.startswith("{"):
        return _parse_json_command(stripped)
    return _parse_shell_command(stripped)


async def _get_latest_report(patient_id: str) -> ReporterOutput | None:
    async with AsyncSessionLocal() as db:
        artifact_result = await db.execute(
            select(AgentArtifact)
            .join(SessionModel, AgentArtifact.session_id == SessionModel.id)
            .where(
                AgentArtifact.agent_name == "reporter_agent",
                AgentArtifact.artifact_kind == "reporter_output",
                SessionModel.patient_id == patient_id,
            )
            .order_by(AgentArtifact.created_at.desc())
            .limit(1)
        )
        latest_artifact = artifact_result.scalars().first()
        if latest_artifact:
            metrics = latest_artifact.artifact_json.get("metrics", {})
            summary = metrics.get("summary")
            if summary:
                return ReporterOutput(
                    summary=summary,
                    session_highlights=metrics.get("session_highlights", []),
                    recommendations=metrics.get("recommendations", []),
                    evidence_map=metrics.get("evidence_map", {}),
                )

        result = await db.execute(
            select(Summary)
            .join(SessionModel, Summary.session_id == SessionModel.id)
            .where(
                Summary.agent_name == "reporter",
                SessionModel.patient_id == patient_id,
            )
            .order_by(Summary.created_at.desc())
            .limit(1)
        )
        summary = result.scalars().first()
        if not summary:
            return None

        return ReporterOutput(
            summary=summary.content,
            session_highlights=[],
            recommendations=[],
            evidence_map={},
        )


async def _run_progress(patient_id: str) -> ProgressOutput:
    async with AsyncSessionLocal() as db:
        output = await run_progress(patient_id, db)
        await db.commit()
        return output


async def _run_advice(patient_id: str, question: str):
    async with AsyncSessionLocal() as db:
        output = await run_patient_advisor(patient_id, question, db)
        await db.commit()
        return output


def _format_latest_report(patient_id: str, output: ReporterOutput | None) -> str:
    if output is None:
        return (
            f"No reporter output was found for patient `{patient_id}`.\n"
            "Make sure the patient already has completed sessions in the backend."
        )

    lines = [f"Latest report for `{patient_id}`", "", output.summary.strip() or "No summary available."]
    if output.session_highlights:
        lines += ["", "Highlights:"]
        lines.extend(f"- {item}" for item in output.session_highlights)
    if output.recommendations:
        lines += ["", "Recommendations:"]
        lines.extend(f"- {item}" for item in output.recommendations)
    return "\n".join(lines)


def _format_progress(patient_id: str, output: ProgressOutput) -> str:
    lines = [
        f"Fresh progress report for `{patient_id}`",
        "",
        f"Overall trend: {output.overall_trend}",
        "",
        output.longitudinal_report.strip() or "No longitudinal report returned.",
    ]
    if output.milestones_reached:
        lines += ["", "Milestones reached:"]
        lines.extend(f"- {item}" for item in output.milestones_reached)
    if output.next_goals:
        lines += ["", "Next goals:"]
        lines.extend(f"- {item}" for item in output.next_goals)
    return "\n".join(lines)


def _format_advice(patient_id: str, output) -> str:
    lines = [
        f"Patient guidance for `{patient_id}`",
        "",
        f"Safety level: {output.safety_level}",
        "",
        output.answer.strip() or "No answer returned.",
    ]
    if output.urgent_flags:
        lines += ["", "Urgent flags:"]
        lines.extend(f"- {item}" for item in output.urgent_flags)
    if output.next_steps:
        lines += ["", "Next steps:"]
        lines.extend(f"- {item}" for item in output.next_steps)
    if output.disclaimer:
        lines += ["", output.disclaimer.strip()]
    return "\n".join(lines)


async def _dispatch_command(request: CommandRequest) -> str:
    if request.command == "help":
        return HELP_TEXT

    if not request.patient_id:
        raise ValueError("`patient_id` is required.")

    if request.command == "latest_report":
        output = await _get_latest_report(request.patient_id)
        return _format_latest_report(request.patient_id, output)

    if request.command == "progress":
        output = await _run_progress(request.patient_id)
        return _format_progress(request.patient_id, output)

    if request.command == "advice":
        if not request.question:
            raise ValueError("`question` is required for `/advice`.")
        output = await _run_advice(request.patient_id, request.question)
        return _format_advice(request.patient_id, output)

    raise ValueError(
        f"Unsupported command `{request.command}`.\n\n{HELP_TEXT}"
    )


@chat_protocol.on_message(ChatMessage)
async def handle_message(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(
        sender,
        ChatAcknowledgement(
            timestamp=datetime.utcnow(),
            acknowledged_msg_id=msg.msg_id,
        ),
    )

    incoming_text = _collect_text(msg)
    try:
        request = _parse_request(incoming_text)
        response_text = await _dispatch_command(request)
    except Exception as exc:
        logger.exception("ASI:One chat request failed")
        response_text = f"{exc}\n\n{HELP_TEXT}"

    await ctx.send(sender, _create_text_chat(response_text, end_session=True))


@chat_protocol.on_message(ChatAcknowledgement)
async def handle_ack(_ctx: Context, _sender: str, _msg: ChatAcknowledgement):
    return


@sentinel_asi_one_agent.on_rest_get("/health", HealthResponse)
async def health_check(_ctx: Context):
    return HealthResponse(status="ok")


sentinel_asi_one_agent.include(chat_protocol, publish_manifest=True)
