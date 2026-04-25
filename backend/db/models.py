import uuid
from datetime import datetime
from sqlalchemy import Column, String, Float, ForeignKey, Text, DateTime, JSON
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
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    sessions = relationship("Session", back_populates="patient")
    accumulated_score = relationship("AccumulatedScore", back_populates="patient", uselist=False)


class Session(Base):
    __tablename__ = "sessions"

    id = Column(String(36), primary_key=True, default=_uuid)
    patient_id = Column(String(36), ForeignKey("patients.id"), nullable=False)
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

    session = relationship("Session", back_populates="frames")


class Summary(Base):
    __tablename__ = "summaries"

    id = Column(String(36), primary_key=True, default=_uuid)
    session_id = Column(String(36), ForeignKey("sessions.id"), nullable=True)
    agent_name = Column(String(64), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    session = relationship("Session", back_populates="summaries")


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(String(36), primary_key=True, default=_uuid)
    actor = Column(String(128), nullable=False)
    action = Column(String(256), nullable=False)
    patient_id = Column(String(36), nullable=True)
    data_type = Column(String(128), nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)
