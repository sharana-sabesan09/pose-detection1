from pydantic import BaseModel
from typing import Optional


class SessionStartRequest(BaseModel):
    patient_id: str
    pt_plan: Optional[str] = None


class SessionStartResponse(BaseModel):
    session_id: str


class FrameRequest(BaseModel):
    angles_json: dict
    timestamp: float


class TokenRequest(BaseModel):
    user_id: str
    role: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
