import math
import statistics
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from db.models import PoseFrame
from schemas.session import PoseAnalysisOutput
from utils.audit import write_audit

# Expected ROM ranges per joint (degrees)
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
}


async def run_pose_analysis(session_id: str, db: AsyncSession) -> PoseAnalysisOutput:
    result = await db.execute(
        select(PoseFrame).where(PoseFrame.session_id == session_id).order_by(PoseFrame.timestamp)
    )
    frames = result.scalars().all()

    if not frames:
        empty = PoseAnalysisOutput(rom_score=0.0, joint_stats={}, flagged_joints=[])
        await write_audit("pose_analysis_agent", "analyze_session", None, "pose_frames", db)
        return empty

    joint_values: dict[str, list[float]] = {}
    for frame in frames:
        angles: dict = frame.angles_json
        for joint, angle in angles.items():
            if isinstance(angle, (int, float)):
                joint_values.setdefault(joint, []).append(float(angle))

    joint_stats: dict = {}
    rom_contributions: list[float] = []
    flagged_joints: list[str] = []

    for joint, values in joint_values.items():
        mn = min(values)
        mx = max(values)
        mean = statistics.mean(values)
        std = statistics.stdev(values) if len(values) > 1 else 0.0
        rom = mx - mn

        joint_stats[joint] = {"mean": mean, "min": mn, "max": mx, "std": std, "rom": rom}
        rom_contributions.append(rom)

        expected = _EXPECTED_ROM.get(joint)
        if expected and (rom / expected) < 0.40:
            flagged_joints.append(joint)

    raw_rom = statistics.mean(rom_contributions) if rom_contributions else 0.0
    # Normalize against average expected ROM
    avg_expected = statistics.mean(_EXPECTED_ROM.values())
    rom_score = min(100.0, (raw_rom / avg_expected) * 100.0)

    output = PoseAnalysisOutput(
        rom_score=round(rom_score, 2),
        joint_stats=joint_stats,
        flagged_joints=flagged_joints,
    )

    await write_audit("pose_analysis_agent", "analyze_session", None, "pose_analysis", db)
    return output
