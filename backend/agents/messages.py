from typing import Optional
from uagents import Model


class IntakeRequest(Model):
    session_id: str
    patient_id: str
    pt_plan: str
    pain_scores: dict
    user_input: str


class IntakeResponse(Model):
    session_id: str
    normalized_pain_scores: dict
    target_joints: list
    session_goals: list
    error: Optional[str] = None


class PoseRequest(Model):
    session_id: str
    patient_id: str


class PoseResponse(Model):
    session_id: str
    rom_score: float
    joint_stats: dict
    flagged_joints: list
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
    error: Optional[str] = None


class ProgressRequest(Model):
    patient_id: str


class ProgressResponse(Model):
    patient_id: str
    longitudinal_report: str
    overall_trend: str
    milestones_reached: list
    next_goals: list
    error: Optional[str] = None
