from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class VoiceNote(BaseModel):
    model_config = ConfigDict(extra="allow")

    stage: Optional[str] = None
    transcript: str
    locale: Optional[str] = None
    capturedAtMs: Optional[float] = None
    engine: Optional[str] = None
    isOnDevice: Optional[bool] = None

    @field_validator("transcript")
    @classmethod
    def validate_transcript(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("transcript must not be empty")
        return cleaned


class VoiceDerivedMetadata(BaseModel):
    model_config = ConfigDict(extra="allow")

    painScore: Optional[float] = None
    painLocations: list[str] = Field(default_factory=list)
    symptoms: list[str] = Field(default_factory=list)
    affectedSide: str = "unknown"
    assistiveDevice: Optional[str] = None
    sessionGoals: list[str] = Field(default_factory=list)
    redFlags: list[str] = Field(default_factory=list)
    subjectiveSummary: Optional[str] = None


class VoiceSessionMetadata(BaseModel):
    model_config = ConfigDict(extra="allow")

    notes: list[VoiceNote] = Field(default_factory=list)
    derived: VoiceDerivedMetadata = Field(default_factory=VoiceDerivedMetadata)


class SessionMetadata(BaseModel):
    model_config = ConfigDict(extra="allow")

    voice: Optional[VoiceSessionMetadata] = None


class VoiceMetadataExtractRequest(BaseModel):
    transcript: str
    stage: Optional[str] = None
    locale: Optional[str] = None
    capturedAtMs: Optional[float] = None
    engine: Optional[str] = None
    isOnDevice: Optional[bool] = None

    @field_validator("transcript")
    @classmethod
    def validate_transcript(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("transcript must not be empty")
        return cleaned


class VoiceMetadataExtractResponse(BaseModel):
    normalizedTranscript: str
    sessionMetadata: SessionMetadata
