import uuid
from datetime import datetime
from sqlalchemy import Column, String, Float, Integer, ForeignKey, Text, DateTime, JSON, Boolean, Index
from sqlalchemy.orm import DeclarativeBase, relationship

# Use plain String(36) for UUIDs — works on both SQLite and PostgreSQL.


class Base(DeclarativeBase):
    pass


def _uuid():
    return str(uuid.uuid4())


class Patient(Base):
    __tablename__ = "patients"

    id = Column(String(36), primary_key=True, default=_uuid)
    name_encrypted = Column(Text, nullable=True)
    dob_encrypted = Column(Text, nullable=True)
    metadata_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    sessions = relationship("Session", back_populates="patient")
    accumulated_score = relationship("AccumulatedScore", back_populates="patient", uselist=False)


class Session(Base):
    __tablename__ = "sessions"

    id = Column(String(36), primary_key=True, default=_uuid)
    patient_id = Column(String(36), ForeignKey("patients.id"), nullable=True)
    pt_plan = Column(Text, nullable=True)
    started_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    ended_at = Column(DateTime, nullable=True)

    patient = relationship("Patient", back_populates="sessions")
    scores = relationship("SessionScore", back_populates="session")
    frames = relationship("PoseFrame", back_populates="session")
    summaries = relationship("Summary", back_populates="session")


class SessionScore(Base):
    __tablename__ = "session_scores"

    id = Column(String(36), primary_key=True, default=_uuid)
    session_id = Column(String(36), ForeignKey("sessions.id"), nullable=False)
    fall_risk_score = Column(Float, nullable=True)
    reinjury_risk_score = Column(Float, nullable=True)
    pain_score = Column(Float, nullable=True)
    rom_score = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    session = relationship("Session", back_populates="scores")


class AccumulatedScore(Base):
    __tablename__ = "accumulated_scores"

    id = Column(String(36), primary_key=True, default=_uuid)
    patient_id = Column(String(36), ForeignKey("patients.id"), nullable=False, unique=True)
    fall_risk_avg = Column(Float, nullable=True)
    reinjury_risk_avg = Column(Float, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    patient = relationship("Patient", back_populates="accumulated_score")


class PoseFrame(Base):
    __tablename__ = "pose_frames"

    id = Column(String(36), primary_key=True, default=_uuid)
    session_id = Column(String(36), ForeignKey("sessions.id"), nullable=False)
    timestamp = Column(Float, nullable=False)
    angles_json = Column(JSON, nullable=False)
    # Optional raw MediaPipe landmarks: [{x,y,z,visibility}, ...] × 33
    landmarks_json = Column(JSON, nullable=True)

    session = relationship("Session", back_populates="frames")


class Summary(Base):
    __tablename__ = "summaries"

    id = Column(String(36), primary_key=True, default=_uuid)
    session_id = Column(String(36), ForeignKey("sessions.id"), nullable=True)
    agent_name = Column(String(64), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    session = relationship("Session", back_populates="summaries")


class ExerciseSession(Base):
    __tablename__ = "exercise_sessions"

    id = Column(String(36), primary_key=True, default=_uuid)
    patient_id = Column(String(36), ForeignKey("patients.id"), nullable=True)
    # ISO timestamp string sent from the mobile app ("2026-04-25T10:57:06.124Z")
    mobile_session_id = Column(String(64), nullable=False, unique=True)
    exercise = Column(String(64), nullable=False)
    num_reps = Column(Integer, nullable=False)
    started_at_ms = Column(Float, nullable=False)
    ended_at_ms = Column(Float, nullable=False)
    duration_ms = Column(Float, nullable=False)
    # Aggregate summary stats (avgDepth, consistency, overallRating, etc.)
    summary_json = Column(JSON, nullable=True)
    metadata_json = Column(JSON, nullable=True)
    reps_csv = Column(Text, nullable=True)
    frame_features_csv = Column(Text, nullable=True)
    # Optional raw landmark CSV (frames.csv) uploaded by the mobile app.
    frames_csv = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # When set, raw PoseFrame rows are stored against this Session so the
    # pose_analysis_agent can read them through the existing frames pipeline.
    linked_session_id = Column(String(36), ForeignKey("sessions.id"), nullable=True)

    patient = relationship("Patient", foreign_keys=[patient_id])
    linked_session = relationship("Session", foreign_keys=[linked_session_id])
    reps = relationship("RepAnalysis", back_populates="exercise_session", cascade="all, delete-orphan")


class RepAnalysis(Base):
    __tablename__ = "rep_analyses"

    id = Column(String(36), primary_key=True, default=_uuid)
    exercise_session_id = Column(String(36), ForeignKey("exercise_sessions.id"), nullable=False)
    rep_id = Column(Integer, nullable=False)
    side = Column(String(10), nullable=False)  # "left" | "right"

    # Timing
    start_frame = Column(Integer, nullable=True)
    bottom_frame = Column(Integer, nullable=True)
    end_frame = Column(Integer, nullable=True)
    rep_duration_ms = Column(Float, nullable=True)

    # Biomechanical features
    knee_flexion_deg = Column(Float, nullable=True)
    rom_ratio = Column(Float, nullable=True)
    fppa_peak = Column(Float, nullable=True)
    fppa_at_depth = Column(Float, nullable=True)
    trunk_lean_peak = Column(Float, nullable=True)
    trunk_flex_peak = Column(Float, nullable=True)
    pelvic_drop_peak = Column(Float, nullable=True)
    pelvic_shift_peak = Column(Float, nullable=True)
    hip_adduction_peak = Column(Float, nullable=True)
    knee_offset_peak = Column(Float, nullable=True)
    sway_norm = Column(Float, nullable=True)
    smoothness = Column(Float, nullable=True)

    # Error flags
    knee_valgus = Column(Boolean, nullable=True)
    trunk_lean = Column(Boolean, nullable=True)
    trunk_flex = Column(Boolean, nullable=True)
    pelvic_drop = Column(Boolean, nullable=True)
    pelvic_shift = Column(Boolean, nullable=True)
    hip_adduction = Column(Boolean, nullable=True)
    knee_over_foot = Column(Boolean, nullable=True)
    balance = Column(Boolean, nullable=True)

    # Score
    total_errors = Column(Integer, nullable=True)
    classification = Column(String(32), nullable=True)
    confidence = Column(Float, nullable=True)

    exercise_session = relationship("ExerciseSession", back_populates="reps")


class AgentArtifact(Base):
    __tablename__ = "agent_artifacts"

    id = Column(String(36), primary_key=True, default=_uuid)
    session_id = Column(String(36), ForeignKey("sessions.id"), nullable=True)
    patient_id = Column(String(36), ForeignKey("patients.id"), nullable=True)
    agent_name = Column(String(64), nullable=False)
    artifact_kind = Column(String(64), nullable=False)
    artifact_json = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    upstream_artifact_ids_json = Column(JSON, nullable=False, default=list)
    data_coverage_json = Column(JSON, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_aa_session_agent", "session_id", "agent_name"),
        Index("ix_aa_patient_agent_time", "patient_id", "agent_name", "created_at"),
    )


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(String(36), primary_key=True, default=_uuid)
    actor = Column(String(128), nullable=False)
    action = Column(String(256), nullable=False)
    patient_id = Column(String(36), nullable=True)
    data_type = Column(String(128), nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)
