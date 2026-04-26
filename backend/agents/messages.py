from typing import Optional
from uagents import Model


class IntakeRequest(Model):
    session_id: str
    patient_id: str
    pt_plan: str
    pain_scores: dict
    user_input: str
    session_type: str = "treatment"


class IntakeResponse(Model):
    session_id: str
    normalized_pain_scores: dict
    target_joints: list
    session_goals: list
    session_type: str = "treatment"
    injured_joints: list = []
    injured_side: str = "unknown"
    rehab_phase: str = "unknown"
    contraindications: list = []
    data_confidence: str = "missing"
    error: Optional[str] = None


class PoseRequest(Model):
    session_id: str
    patient_id: str


class PoseResponse(Model):
    session_id: str
    rom_score: float
    joint_stats: dict
    flagged_joints: list
    frame_count: int = 0
    joint_coverage: dict = {}
    data_sufficient: bool = False
    data_coverage: dict = {}
    error: Optional[str] = None


class FallRiskRequest(Model):
    session_id: str
    patient_id: str
    intake: dict
    pose: dict


class FallRiskResponse(Model):
    session_id: str
    score: float
    risk_level: str
    reasoning: str
    contributing_factors: list
    rag_used: bool = False
    rag_sources: list = []
    error: Optional[str] = None


class ReinjuryRiskRequest(Model):
    session_id: str
    patient_id: str
    pose: dict


class ReinjuryRiskResponse(Model):
    session_id: str
    score: float
    trend: str
    reasoning: str
    sessions_used: int = 0
    data_sufficient: bool = False
    injured_joint_trend: dict = {}
    error: Optional[str] = None


class ReporterRequest(Model):
    session_id: str
    patient_id: str
    intake: dict
    pose: dict
    fall_risk: dict
    reinjury_risk: dict


class ReporterResponse(Model):
    session_id: str
    summary: str
    session_highlights: list
    recommendations: list
    evidence_map: dict = {}
    reportability: str = "unknown"
    data_coverage: dict = {}
    error: Optional[str] = None


class ProgressRequest(Model):
    patient_id: str


class ProgressResponse(Model):
    patient_id: str
    longitudinal_report: str
    overall_trend: str
    milestones_reached: list
    next_goals: list
    evidence_citations: dict = {}
    data_warnings: list = []
    error: Optional[str] = None


class PatientAdviceRequestMessage(Model):
    request_id: str
    patient_id: str
    question: str


class PatientAdviceResponseMessage(Model):
    request_id: str
    patient_id: str
    answer: str
    safety_level: str
    urgent_flags: list[str]
    next_steps: list[str]
    disclaimer: str
    error: Optional[str] = None
