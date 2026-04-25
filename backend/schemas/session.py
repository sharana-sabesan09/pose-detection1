from pydantic import BaseModel


class IntakeInput(BaseModel):
    session_id: str
    patient_id: str
    pt_plan: str
    pain_scores: dict
    user_input: str


class IntakeOutput(BaseModel):
    normalized_pain_scores: dict
    target_joints: list[str]
    session_goals: list[str]


class PoseAnalysisOutput(BaseModel):
    rom_score: float
    joint_stats: dict
    flagged_joints: list[str]


class FallRiskOutput(BaseModel):
    score: float
    risk_level: str
    reasoning: str
    contributing_factors: list[str]


class ReinjuryRiskOutput(BaseModel):
    score: float
    trend: str
    reasoning: str


class ReporterOutput(BaseModel):
    summary: str
    session_highlights: list[str]
    recommendations: list[str]


class ProgressOutput(BaseModel):
    longitudinal_report: str
    overall_trend: str
    milestones_reached: list[str]
    next_goals: list[str]
