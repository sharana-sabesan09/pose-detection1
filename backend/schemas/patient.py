from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class PatientMetadata(BaseModel):
    age: int
    gender: Literal["male", "female", "other"]
    heightCm: float
    weightKg: float
    bmi: float
    demographicRiskScore: float


class PatientUpsertRequest(PatientMetadata):
    pass


class PatientResponse(BaseModel):
    id: str
    metadata: PatientMetadata | None
    created_at: datetime
    updated_at: datetime


class AccumulatedScoresResponse(BaseModel):
    fall_risk_avg: float | None
    reinjury_risk_avg: float | None


class PatientSessionOverview(BaseModel):
    session_id: str
    kind: Literal["exercise", "pt"]
    started_at: datetime
    ended_at: datetime | None
    exercise: str | None
    summary: str | None
    fall_risk_score: float | None
    reinjury_risk_score: float | None
    rom_score: float | None


class PatientOverviewResponse(PatientResponse):
    session_count: int
    accumulated_scores: AccumulatedScoresResponse | None
    recent_sessions: list[PatientSessionOverview]
