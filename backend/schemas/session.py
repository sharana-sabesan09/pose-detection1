from datetime import datetime
from pydantic import BaseModel


class IntakeInput(BaseModel):
    session_id: str
    patient_id: str
    pt_plan: str
    pain_scores: dict
    user_input: str
    session_type: str = "treatment"  # "assessment" | "treatment" | "home_exercise_check"
    ended_at: datetime | None = None


class IntakeOutput(BaseModel):
    normalized_pain_scores: dict
    target_joints: list[str]
    session_goals: list[str]
    session_type: str = "treatment"
    # Clinical metadata — populated from Patient.metadata_json when available
    injured_joints: list[str] = []
    injured_side: str = "unknown"
    rehab_phase: str = "unknown"
    contraindications: list[str] = []
    data_confidence: str = "missing"  # "explicit" | "inferred" | "missing"


class PoseAnalysisOutput(BaseModel):
    rom_score: float
    joint_stats: dict
    flagged_joints: list[str]
    frame_count: int = 0
    joint_coverage: dict = {}  # {joint_name: frame_count}
    data_sufficient: bool = False
    data_coverage: dict = {}


class FallRiskOutput(BaseModel):
    score: float
    risk_level: str
    reasoning: str
    contributing_factors: list[str]
    rag_used: bool = False
    rag_sources: list[str] = []


class ReinjuryRiskOutput(BaseModel):
    score: float
    trend: str
    reasoning: str
    sessions_used: int = 0
    data_sufficient: bool = False
    injured_joint_trend: dict = {}


class ReporterOutput(BaseModel):
    summary: str
    session_highlights: list[str]
    recommendations: list[str]
    evidence_map: dict = {}
    contributing_factors: list[str] = []
    good_reps: int | None = None
    filtered_reps: int | None = None
    reportability: str = "unknown"
    data_coverage: dict = {}


class ProgressOutput(BaseModel):
    longitudinal_report: str
    overall_trend: str
    milestones_reached: list[str]
    next_goals: list[str]
    evidence_citations: dict = {}
    data_warnings: list[str] = []


class ExerciseReporterOutput(BaseModel):
    summary: str
    session_highlights: list[str]
    recommendations: list[str]
    fall_risk_score: float
    reinjury_risk_score: float
    rom_score: float
    good_reps: int
    filtered_reps: int
