from pydantic import BaseModel, model_validator
from typing import Optional, Self
from schemas.voice import SessionMetadata


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
    # Optional artifact copies from the mobile app. Stored with the session
    # row so the exact uploaded CSVs are queryable later.
    repsCsv: Optional[str] = None
    frameFeaturesCsv: Optional[str] = None
    framesCsv: Optional[str] = None
    sessionMetadata: Optional[SessionMetadata] = None
    # Optional calibration markers (fixed 4-step protocol on mobile).
    calibrationBatchId: Optional[str] = None
    calibrationStep: Optional[int] = None

    @model_validator(mode="after")
    def _validate_calibration(self) -> Self:
        has_batch = self.calibrationBatchId is not None
        has_step = self.calibrationStep is not None
        if has_batch ^ has_step:
            raise ValueError("calibrationBatchId and calibrationStep must be provided together")
        if has_step:
            if not (1 <= int(self.calibrationStep) <= 4):  # type: ignore[arg-type]
                raise ValueError("calibrationStep must be between 1 and 4")
        if has_batch:
            b = (self.calibrationBatchId or "").strip()
            if not b:
                raise ValueError("calibrationBatchId must be non-empty")
            self.calibrationBatchId = b
        return self


class ExerciseSessionResponse(BaseModel):
    id: str
    sessionId: str
    exercise: str
    numReps: int
    overallRating: str
    # UUID of the companion Session row — pass to POST /sessions/{id}/frame
    # and POST /exports/session so raw frames land in the DB for the agents.
    linkedSessionId: str
    calibrationBatchId: Optional[str] = None
    calibrationStep: Optional[int] = None
