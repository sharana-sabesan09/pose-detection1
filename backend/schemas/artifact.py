from pydantic import BaseModel


class ExerciseSessionArtifactResponse(BaseModel):
    id: str
    exerciseSessionId: str
    artifactType: str
    contentType: str
    sizeBytes: int
    createdAt: str

