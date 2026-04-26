from datetime import datetime
from pydantic import BaseModel
from typing import Optional


class SessionStartRequest(BaseModel):
    session_id: Optional[str] = None
    patient_id: str
    pt_plan: Optional[str] = None
    started_at: Optional[datetime] = None


class SessionStartResponse(BaseModel):
    session_id: str


class FrameRequest(BaseModel):
    angles_json: dict
    timestamp: float


class FrameFeaturesCsvRequest(BaseModel):
    frame_features_csv: str


class TokenRequest(BaseModel):
    user_id: str
    role: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
