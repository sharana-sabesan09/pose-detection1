import re

from schemas.voice import (
    SessionMetadata,
    VoiceDerivedMetadata,
    VoiceMetadataExtractRequest,
    VoiceNote,
    VoiceSessionMetadata,
)

_PAIN_PATTERNS = (
    re.compile(r"\b(?:pain|pain level|pain score)\s*(?:is|at|of)?\s*(\d+(?:\.\d+)?)\b"),
    re.compile(r"\b(\d+(?:\.\d+)?)\s*(?:/|out of)\s*10\b"),
)

_LOCATION_PATTERNS = (
    (re.compile(r"\bknee(?:s)?\b"), "knee"),
    (re.compile(r"\bhip(?:s)?\b"), "hip"),
    (re.compile(r"\blower back\b|\bback\b"), "lower_back"),
    (re.compile(r"\bankle(?:s)?\b"), "ankle"),
    (re.compile(r"\bshoulder(?:s)?\b"), "shoulder"),
    (re.compile(r"\bneck\b"), "neck"),
    (re.compile(r"\bcalf(?:s)?\b"), "calf"),
    (re.compile(r"\bhamstring(?:s)?\b"), "hamstring"),
    (re.compile(r"\bquad(?:s)?\b|\bquadricep(?:s)?\b"), "quad"),
)

_SYMPTOM_PATTERNS = (
    (re.compile(r"\bpain\b|\bsore\b|\bsoreness\b"), "pain"),
    (re.compile(r"\bstiff\b|\bstiffness\b"), "stiffness"),
    (re.compile(r"\bfatigue\b|\btired\b|\bexhausted\b"), "fatigue"),
    (re.compile(r"\bdizzy\b|\bdizziness\b|\blightheaded\b"), "dizziness"),
    (re.compile(r"\binstability\b|\bunstable\b|\bwobbl"), "instability"),
    (re.compile(r"\bswelling\b|\bswollen\b"), "swelling"),
    (re.compile(r"\bnumb\b|\bnumbness\b"), "numbness"),
    (re.compile(r"\btingl"), "tingling"),
)

_GOAL_PATTERNS = (
    (re.compile(r"\bbalance\b|\bstable\b|\bstability\b"), "balance"),
    (re.compile(r"\bstrength\b|\bstronger\b"), "strength"),
    (re.compile(r"\bmobility\b|\brange of motion\b|\bflexibility\b"), "mobility"),
    (re.compile(r"\bdepth\b|\bsquat lower\b"), "depth"),
    (re.compile(r"\bpain reduction\b|\bless pain\b|\breduce pain\b"), "pain_reduction"),
    (re.compile(r"\bconfidence\b"), "confidence"),
)

_DEVICE_PATTERNS = (
    (re.compile(r"\bwalker\b"), "walker"),
    (re.compile(r"\bcane\b"), "cane"),
    (re.compile(r"\bcrutch(?:es)?\b"), "crutches"),
    (re.compile(r"\bbrace\b"), "brace"),
    (re.compile(r"\bboot\b"), "boot"),
    (re.compile(r"\bwheelchair\b"), "wheelchair"),
)

_RED_FLAG_PATTERNS = (
    (re.compile(r"\bfall\b|\bfell\b"), "recent_fall"),
    (re.compile(r"\bdizzy\b|\bdizziness\b|\blightheaded\b"), "dizziness"),
    (re.compile(r"\bnumb\b|\bnumbness\b"), "numbness"),
    (re.compile(r"\btingl"), "tingling"),
    (re.compile(r"\bchest pain\b"), "chest_pain"),
    (re.compile(r"\bshortness of breath\b|\bbreathless\b"), "shortness_of_breath"),
)


def _normalize_transcript(transcript: str) -> str:
    return re.sub(r"\s+", " ", transcript).strip()


def _extract_pain_score(text: str) -> float | None:
    for pattern in _PAIN_PATTERNS:
        match = pattern.search(text)
        if not match:
            continue
        value = float(match.group(1))
        return max(0.0, min(10.0, value))
    return None


def _extract_ordered_tags(text: str, patterns: tuple[tuple[re.Pattern[str], str], ...]) -> list[str]:
    tags: list[str] = []
    for pattern, tag in patterns:
        if pattern.search(text):
            tags.append(tag)
    return tags


def _extract_assistive_device(text: str) -> str | None:
    for pattern, device in _DEVICE_PATTERNS:
        if pattern.search(text):
            return device
    return None


def _extract_affected_side(text: str) -> str:
    if re.search(r"\bbilateral\b|\bboth sides?\b|\bboth knees\b|\bboth hips\b", text):
        return "bilateral"
    has_left = bool(re.search(r"\bleft\b", text))
    has_right = bool(re.search(r"\bright\b", text))
    if has_left and has_right:
        return "bilateral"
    if has_left:
        return "left"
    if has_right:
        return "right"
    return "unknown"


def build_session_metadata_from_voice(body: VoiceMetadataExtractRequest) -> tuple[str, SessionMetadata]:
    normalized = _normalize_transcript(body.transcript)
    lowered = normalized.lower()

    note = VoiceNote(
        stage=body.stage,
        transcript=normalized,
        locale=body.locale,
        capturedAtMs=body.capturedAtMs,
        engine=body.engine,
        isOnDevice=body.isOnDevice,
    )
    derived = VoiceDerivedMetadata(
        painScore=_extract_pain_score(lowered),
        painLocations=_extract_ordered_tags(lowered, _LOCATION_PATTERNS),
        symptoms=_extract_ordered_tags(lowered, _SYMPTOM_PATTERNS),
        affectedSide=_extract_affected_side(lowered),
        assistiveDevice=_extract_assistive_device(lowered),
        sessionGoals=_extract_ordered_tags(lowered, _GOAL_PATTERNS),
        redFlags=_extract_ordered_tags(lowered, _RED_FLAG_PATTERNS),
        subjectiveSummary=normalized,
    )
    metadata = SessionMetadata(
        voice=VoiceSessionMetadata(
            notes=[note],
            derived=derived,
        )
    )
    return normalized, metadata
