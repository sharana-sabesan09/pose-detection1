import math
import logging
import statistics

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uagents import Agent, Context

from db.models import PoseFrame
from schemas.session import PoseAnalysisOutput
from agents.messages import PoseRequest, PoseResponse
from utils.artifacts import write_artifact
from utils.audit import write_audit

logger = logging.getLogger(__name__)

# Expected ROM ranges per joint (degrees).
# Features flagged when their range-of-motion is < 40 % of this value.
_EXPECTED_ROM = {
    "hip_flexion": 120,
    "hip_extension": 30,
    "hip_abduction": 45,
    "knee_flexion": 135,
    "ankle_dorsiflexion": 20,
    "ankle_plantarflexion": 50,
    "shoulder_flexion": 180,
    "shoulder_abduction": 180,
    "lumbar_flexion": 60,
    "knee_flex": 135,
    "trunk_flex": 60,
}

# Frame CSV features where a HIGH peak value signals a movement error.
_ERROR_THRESHOLDS: dict[str, float] = {
    "fppa":          8.0,
    "trunk_lean":   10.0,
    "pelvic_drop":   5.0,
    "hip_adduction": 10.0,
    "knee_offset":   0.20,
}


def build_pose_data_coverage(frame_count: int, joint_stats: dict[str, dict]) -> dict:
    missing_fields: list[str] = []
    notes: list[str] = []

    if frame_count == 0:
        missing_fields.append("pose_frames")
        notes.append("no frames recorded")
    if frame_count > 0 and not joint_stats:
        missing_fields.append("joint_stats")
        notes.append("frames were stored without numeric joint measurements")
    if not missing_fields and frame_count > 0:
        notes.append(f"{frame_count} frames analysed, {len(joint_stats)} joints tracked")

    return {
        "required_fields_present": not missing_fields,
        "missing_fields": missing_fields,
        "notes": notes,
    }


def get_pose_data_coverage(pose: PoseAnalysisOutput) -> dict:
    coverage = build_pose_data_coverage(pose.frame_count, pose.joint_stats)
    existing = pose.data_coverage or {}

    for field in existing.get("missing_fields", []):
        if field not in coverage["missing_fields"]:
            coverage["missing_fields"].append(field)
    for note in existing.get("notes", []):
        if note not in coverage["notes"]:
            coverage["notes"].append(note)

    if "required_fields_present" in existing:
        coverage["required_fields_present"] = (
            coverage["required_fields_present"] and bool(existing["required_fields_present"])
        )

    return coverage


def pose_has_sufficient_data(pose: PoseAnalysisOutput) -> bool:
    return bool(get_pose_data_coverage(pose).get("required_fields_present"))


async def run_pose_analysis(session_id: str, db: AsyncSession, patient_id: str | None = None) -> PoseAnalysisOutput:
    result = await db.execute(
        select(PoseFrame).where(PoseFrame.session_id == session_id).order_by(PoseFrame.timestamp)
    )
    frames = result.scalars().all()

    if not frames:
        data_coverage = build_pose_data_coverage(frame_count=0, joint_stats={})
        empty = PoseAnalysisOutput(
            rom_score=0.0, joint_stats={}, flagged_joints=[],
            frame_count=0, joint_coverage={},
            data_sufficient=False,
            data_coverage=data_coverage,
        )
        await write_artifact(
            agent_name="pose_analysis_agent",
            session_id=session_id,
            patient_id=patient_id or "",
            artifact_kind="pose_analysis_output",
            artifact_json={
                "metrics": {
                    "rom_score": 0.0,
                    "frame_count": 0,
                    "joint_coverage": {},
                    "joint_stats": {},
                    "flagged_joints": [],
                    "data_sufficient": False,
                }
            },
            upstream_artifact_ids=[],
            data_coverage=data_coverage,
            db=db,
        )
        await write_audit("pose_analysis_agent", "analyze_session", patient_id, "pose_frames", db)
        return empty

    joint_values: dict[str, list[float]] = {}
    joint_frame_counts: dict[str, int] = {}

    for frame in frames:
        angles: dict = frame.angles_json
        for joint, angle in angles.items():
            if isinstance(angle, (int, float)):
                val = float(angle)
                joint_values.setdefault(joint, []).append(val)
                joint_frame_counts[joint] = joint_frame_counts.get(joint, 0) + 1

    joint_stats: dict = {}
    rom_contributions: list[float] = []
    flagged_joints: list[str] = []

    for joint, values in joint_values.items():
        mn = min(values)
        mx = max(values)
        mean = statistics.mean(values)
        std = statistics.stdev(values) if len(values) > 1 else 0.0
        rom = mx - mn

        joint_stats[joint] = {"mean": round(mean, 3), "min": round(mn, 3), "max": round(mx, 3), "std": round(std, 3), "rom": round(rom, 3)}
        rom_contributions.append(rom)

        expected = _EXPECTED_ROM.get(joint)
        if expected and (rom / expected) < 0.40:
            flagged_joints.append(joint)

        error_thresh = _ERROR_THRESHOLDS.get(joint)
        if error_thresh and mx > error_thresh and joint not in flagged_joints:
            flagged_joints.append(joint)

    raw_rom = statistics.mean(rom_contributions) if rom_contributions else 0.0
    avg_expected = statistics.mean(_EXPECTED_ROM.values())
    rom_score = min(100.0, (raw_rom / avg_expected) * 100.0)

    frame_count = len(frames)
    data_coverage = build_pose_data_coverage(frame_count=frame_count, joint_stats=joint_stats)

    output = PoseAnalysisOutput(
        rom_score=round(rom_score, 2),
        joint_stats=joint_stats,
        flagged_joints=flagged_joints,
        frame_count=frame_count,
        joint_coverage=joint_frame_counts,
        data_sufficient=data_coverage["required_fields_present"],
        data_coverage=data_coverage,
    )

    await write_artifact(
        agent_name="pose_analysis_agent",
        session_id=session_id,
        patient_id=patient_id or "",
        artifact_kind="pose_analysis_output",
        artifact_json={
            "metrics": {
                "rom_score": output.rom_score,
                "frame_count": frame_count,
                "joint_coverage": joint_frame_counts,
                "joint_stats": joint_stats,
                "flagged_joints": flagged_joints,
                "data_sufficient": output.data_sufficient,
            }
        },
        upstream_artifact_ids=[],
        data_coverage=data_coverage,
        db=db,
    )

    await write_audit("pose_analysis_agent", "analyze_session", patient_id, "pose_analysis", db)
    return output


pose_agent = Agent(name="pose-analysis-agent", seed="physio-pose-analysis-agent-sentinel-v1")


@pose_agent.on_message(model=PoseRequest)
async def _handle_pose(ctx: Context, sender: str, msg: PoseRequest):
    from db.session import AsyncSessionLocal
    try:
        async with AsyncSessionLocal() as db:
            output = await run_pose_analysis(msg.session_id, db, patient_id=msg.patient_id)
            await db.commit()
            await ctx.send(sender, PoseResponse(
                session_id=msg.session_id, **output.model_dump()
            ))
    except Exception as e:
        logger.error("pose_analysis uagent error: %s", e)
        await ctx.send(sender, PoseResponse(
            session_id=msg.session_id,
            rom_score=0.0, joint_stats={}, flagged_joints=[],
            data_sufficient=False,
            data_coverage={"required_fields_present": False, "missing_fields": ["pose_analysis"], "notes": [str(e)]},
            error=str(e),
        ))
