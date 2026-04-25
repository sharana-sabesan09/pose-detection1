from pydantic import BaseModel
from typing import Optional


class RepTiming(BaseModel):
    startFrame: int
    bottomFrame: int
    endFrame: int
    durationMs: float


class RepFeatures(BaseModel):
    kneeFlexionDeg: float
    romRatio: float
    fppaPeak: float
    fppaAtDepth: float
    trunkLeanPeak: float
    trunkFlexPeak: float
    pelvicDropPeak: float
    pelvicShiftPeak: float
    hipAdductionPeak: float
    kneeOffsetPeak: float
    swayNorm: float
    smoothness: float


class RepErrors(BaseModel):
    kneeValgus: bool
    trunkLean: bool
    trunkFlex: bool
    pelvicDrop: bool
    pelvicShift: bool
    hipAdduction: bool
    kneeOverFoot: bool
    balance: bool


class RepScore(BaseModel):
    totalErrors: int
    classification: str


class RepData(BaseModel):
    repId: int
    side: str
    timing: RepTiming
    features: RepFeatures
    errors: RepErrors
    score: RepScore
    confidence: float


class ExerciseSummaryStats(BaseModel):
    numReps: int
    avgDepth: float
    minDepth: float
    avgFppa: float
    maxFppa: float
    consistency: float
    overallRating: str


class ExerciseSummary(BaseModel):
    exercise: str
    reps: list[RepData]
    summary: ExerciseSummaryStats


class ExerciseSessionResult(BaseModel):
    sessionId: str
    startedAtMs: float
    endedAtMs: float
    durationMs: float
    exercise: str
    numReps: int
    summary: ExerciseSummary
    # optional — links the session to a patient record
    patientId: Optional[str] = None


class ExerciseSessionResponse(BaseModel):
    id: str
    sessionId: str
    exercise: str
    numReps: int
    overallRating: str
    # UUID of the companion Session row — pass to POST /sessions/{id}/frame
    # and POST /exports/session so raw frames land in the DB for the agents.
    linkedSessionId: str
