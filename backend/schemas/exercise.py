from pydantic import BaseModel
from typing import Optional
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


class InjuredJointRom(BaseModel):
    joint: str                  # mediapipe-style joint name, e.g. "right_knee"
    rom: Optional[float] = None  # null = exercise ran but no reps detected


class ExerciseResult(BaseModel):
    """Per-exercise upload body for POST /sessions/exercise-result.

    ``sessionId`` is the legacy field name kept for backward compatibility
    with older mobile builds — it carries the synthetic per-exercise id
    (e.g. ``<visitId>-<exercise>-<i>``). ``visitId`` is the top-level
    MultiExerciseSession.sessionId shared across the visit's exercises.
    """

    sessionId: str
    # Top-level MultiExerciseSession.sessionId — shared across all exercises
    # from one visit. Optional so older mobile builds continue to work; we
    # default it to ``sessionId`` server-side when absent.
    visitId: Optional[str] = None
    # Per-exercise ROM for the patient's injured joint on this visit, copied
    # from MultiExerciseSession.patient.injuredJoint.romByExercise[exercise].
    injuredJointRom: Optional[InjuredJointRom] = None
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


class ExerciseResponse(BaseModel):
    id: str
    sessionId: str
    visitId: str
    exercise: str
    numReps: int
    overallRating: str
    # UUID of the companion Session row — pass to POST /sessions/{id}/frame
    # and POST /exports/session so raw frames land in the DB for the agents.
    linkedSessionId: str


# Backward-compat aliases — older imports continue to work during the rename.
ExerciseSessionResult = ExerciseResult
ExerciseSessionResponse = ExerciseResponse


class MultiExerciseArchivePayload(BaseModel):
    """Full MultiExerciseSession JSON for POST /sessions/multi-exercise-archive.

    Stored verbatim for future longitudinal agents. The current ingest
    path does NOT read this back — write-only for now.
    """

    visitId: str
    startedAtMs: float
    endedAtMs: float
    durationMs: float
    patientId: Optional[str] = None
    payload: dict   # full MultiExerciseSession verbatim
