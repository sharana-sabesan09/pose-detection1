# Frontend Data Requirements

This document lists every piece of data the backend agents need that the
frontend does not currently send. It is the reference for what must be added
to the patient registration flow and session intake flow.

---

## Summary

| Field | Where it belongs | Currently sent? | Blocking which agents |
|---|---|---|---|
| `injured_joints` | Patient registration | No | `reinjury_risk`, `intake`, `progress` |
| `injured_side` | Patient registration | No | `intake`, `fall_risk` |
| `rehab_phase` | Patient registration | No | `intake`, `reporter`, `progress` |
| `diagnosis` | Patient registration | No | `intake`, `fall_risk` |
| `contraindications` | Patient registration | No | `intake`, `fall_risk` |
| `restrictions` | Patient registration | No | `intake` |
| `session_type` | Session end / intake | No | `reporter`, `progress` |
| `pt_plan` | Session start / end | Sent but often blank | `intake` (entire pipeline degrades) |
| `pain_scores` | Session end / intake | Sent — format undocumented | `intake`, `fall_risk` |
| `demographicRiskScore` | Patient registration | Sent — **never read** | `fall_risk` (unused) |

---

## Patient-Level Clinical Data

These fields belong on the patient record. They are set once at registration
and updated when the patient's clinical situation changes. They are stored in
`Patient.metadata_json` alongside the existing demographics.

### Currently in `PatientMetadata`

```
age: int
gender: "male" | "female" | "other"
heightCm: float
weightKg: float
bmi: float
demographicRiskScore: float   ← sent but never consumed by any agent (see below)
```

### Missing fields to add

---

#### `injured_joints: list[str]`

The anatomical joints involved in the primary injury, using the naming
convention the backend already uses for pose analysis.

Required values use the joint name keys from `pose_analysis.py`:
```
"hip_flexion"         "hip_extension"         "hip_abduction"
"knee_flexion"        "ankle_dorsiflexion"    "ankle_plantarflexion"
"shoulder_flexion"    "shoulder_abduction"    "lumbar_flexion"
```

Example: `["knee_flexion", "hip_flexion"]` for a left knee patient who also
has secondary hip involvement.

**Agents blocked without this field**
- `reinjury_risk_agent` — uses this to select which joints to track historically.
  Without it, falls back to the union of joints flagged across the last 3 sessions,
  which is noisier.
- `intake_agent` — uses this to anchor injury-specific goal extraction.
- `progress_agent` — uses this to anchor the salience selector on clinically
  meaningful joint trends.

---

#### `injured_side: "left" | "right" | "bilateral"`

Which side the primary injury affects.

**Agents blocked without this field**
- `intake_agent` — cannot distinguish left vs right deterioration in pose data.
- `fall_risk_agent` — cannot weight contralateral compensation patterns correctly.

---

#### `rehab_phase: "acute" | "sub-acute" | "functional" | "return-to-sport"`

The current rehabilitation phase. This changes over the course of treatment and
should be updated by the clinician when the patient advances.

| Phase | Typical timeframe | Clinical meaning |
|---|---|---|
| `acute` | 0–2 weeks post-injury/surgery | Pain and swelling management |
| `sub-acute` | 2–6 weeks | Guided range of motion restoration |
| `functional` | 6–12 weeks | Strength and functional movement |
| `return-to-sport` | 12 weeks+ | Sport-specific conditioning |

**Agents blocked without this field**
- `intake_agent` — cannot set context-appropriate session goals.
- `reporter_agent` — recommendations are phase-agnostic without this.
- `progress_agent` — cannot detect phase transitions as milestones.

---

#### `diagnosis: str`

Free-text primary diagnosis from the treating clinician.

Examples: `"ACL reconstruction (left)"`, `"Patellofemoral pain syndrome"`,
`"Grade II ankle sprain (right)"`, `"Rotator cuff repair"`.

**Agents blocked without this field**
- `intake_agent` — LLM guesses diagnosis from `pt_plan` text; errors propagate
  to all downstream agents.
- `fall_risk_agent` — RAG query is less targeted without a diagnosis term.

---

#### `contraindications: list[str]`

Specific movements or loads the clinician has prohibited for this patient.

Examples: `["deep squat below 90°", "full weight-bearing", "end-range hip IR"]`

**Agents blocked without this field**
- `intake_agent` — cannot flag when a session plan includes a contraindicated
  movement.
- `fall_risk_agent` — cannot incorporate contraindication breaches as risk
  factors.

---

#### `restrictions: list[str]`

Load or range-of-motion restrictions that are not full contraindications but
must be respected during session planning.

Examples: `["maximum 50% body weight", "knee flexion < 90°"]`

**Agents blocked without this field**
- `intake_agent` — session goals may be set beyond safe limits.

---

## Session-Level Intake Data

These fields are sent at session end (`POST /sessions/{id}/end`). The body
schema is `IntakeInput`.

### Currently in `IntakeInput`

```
session_id: str
patient_id: str
pt_plan: str         ← exists but often sent blank
pain_scores: dict    ← exists but format not documented on the client side
user_input: str      ← patient's subjective report
```

### Issues with existing fields

---

#### `pt_plan` — exists but often blank

The session pipeline works best when `pt_plan` contains the clinician's
treatment plan for this session. When it is empty, `intake_agent` has no
source for `target_joints` or `session_goals` and falls back to guessing
from `user_input` alone.

Expected content:
- Target joints and exercise types planned
- Intensity or load parameters
- Any session-specific notes from the clinician

Even a short note improves agent output quality significantly.

---

#### `pain_scores` — exists but format is undocumented client-side

Backend expects: `{"joint_name": score_0_to_10}`.

Use the same joint name keys as `injured_joints` above. Omit joints with no
pain rather than sending a 0.

Correct: `{"knee_flexion": 4, "hip_flexion": 2}`
Incorrect: `{"knee": 4}` (will not match pose analysis joint names)

---

### Missing session-level fields

---

#### `session_type: "assessment" | "treatment" | "home_exercise_check"`

What kind of session this is.

| Value | Meaning |
|---|---|
| `assessment` | Formal measurement session; scores are baselines |
| `treatment` | Standard rehabilitation session |
| `home_exercise_check` | Remote or home session with limited pose data expected |

**Agents affected**
- `reporter_agent` — an assessment session warrants different language than a
  treatment session.
- `progress_agent` — assessment sessions should be weighted more heavily as
  reliable baseline points.

---

## Unused Data Already Sent

### `demographicRiskScore`

This field is computed by the mobile app and stored in `Patient.metadata_json`.
No backend agent currently reads it.

`fall_risk_agent` is the natural consumer — demographic risk (age, BMI, gender)
is a recognised fall risk component. This field should be included in the
`fall_risk_agent` LLM prompt once Phase 4 (intake enrichment) is implemented.

No action needed from the front-end — the field is already sent. The backend
change is tracked in Phase 4 of `backend/AGENT_ARCHITECTURE_REFINEMENT.md`.

---

## Implementation Notes for the Frontend

- All patient-level fields should be added to the patient registration / edit
  screen and submitted to `PUT /patients/{patient_id}`.
- `PatientUpsertRequest` in `backend/schemas/patient.py` must be extended to
  include the new fields before the frontend can send them.
- `session_type` should be added to the session-end screen and included in the
  `POST /sessions/{id}/end` body. `IntakeInput` in `backend/schemas/session.py`
  must be extended to accept it.
- All new fields should be optional with sensible defaults so existing app
  versions continue to work:
  - `injured_joints: list[str] = []`
  - `injured_side: str = "unknown"`
  - `rehab_phase: str = "unknown"`
  - `diagnosis: str = ""`
  - `contraindications: list[str] = []`
  - `restrictions: list[str] = []`
  - `session_type: str = "treatment"`
