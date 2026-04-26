from pydantic import BaseModel


class PatientAdviceRequest(BaseModel):
    question: str


class PatientAdviceResponse(BaseModel):
    answer: str
    safety_level: str
    urgent_flags: list[str]
    next_steps: list[str]
    disclaimer: str
