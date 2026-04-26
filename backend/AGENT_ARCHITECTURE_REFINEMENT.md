# Agent Architecture Refinement

Date: 2026-04-25

## Goal

Make the existing agent pipeline clinically grounded and traceable without
changing the overall agent shape. Every agent produces a durable, machine-readable
artifact. Downstream agents consume those artifacts instead of re-deriving context
from prose. The progress layer gets structured evidence, not just summaries.

**Scope**: PT session pipeline only (`intake → pose → fall_risk + reinjury_risk →
reporter → progress`). The exercise pipeline (`exercise_reporter`) is out of scope
and will be addressed separately with a local Med Gemma model.

---

## What Is Wrong Right Now

### 1. `progress_agent` summarises prose without structured evidence

Current inputs:
- All `Summary(agent_name="reporter")` rows — plain text
- `AccumulatedScore.fall_risk_avg` and `reinjury_risk_avg` — two floats

Problems:
- Cannot inspect the metrics that drove earlier conclusions
- Cannot distinguish a session with strong data from one with thin data
- Cannot identify which session triggered a milestone or regression
- `Summary(session_id=None)` — the progress report is not linked to any evidence bundle

### 2. Agent outputs lose provenance as they move downstream

Every agent currently emits:
- One structured output object in memory
- One prose row in `summaries`
- A few numeric columns in `session_scores`

What is missing:
- Upstream source references
- Distinction between directly measured facts and LLM-inferred interpretations
- Data-sufficiency flags
- A durable machine-readable artifact reusable by later agents

### 3. `reinjury_risk_agent` has insufficient historical inputs

The agent queries `SessionScore` for the last 5 sessions — one aggregate float
per session. This cannot answer:
- Which specific joint is deteriorating
- Whether the same movement error is recurring
- Whether the trend is data-sufficient (how many sessions actually had measurements)

### 4. RAG failures are silent

If Chroma returns nothing, the agent continues without acknowledgement. The
resulting report looks identical whether or not guidelines were used.

### 5. No canonical evidence packet

There is no shared schema that says what an agent is allowed to claim, which
claims are directly measured vs inferred, or which upstream artifacts support
each claim.

---

## Design Principles

1. **Agents write their own artifacts.** Each agent is responsible for persisting
   its output to `agent_artifacts` before returning. The orchestrator does not
   write artifacts on an agent's behalf.

2. **Artifacts travel through the pipeline.** Downstream agents consume prior
   artifacts rather than raw DB queries where artifacts are available.

3. **LLMs narrate. Deterministic code scores and selects.** All thresholds,
   deltas, and trend directions are computed before the LLM call.

4. **Every claim is traceable.** For any sentence in a progress report you should
   be able to identify which sessions and metrics support it.

5. **Missing data is explicit.** If required inputs are absent the artifact
   records what is missing. Confidence degrades visibly rather than silently.

6. **Session goals stay LLM-based.** `session_goals` is a `list[str]` produced
   by intake and used by reporter for context. No structured goal-completion logic
   is added — milestone detection in the progress layer remains LLM-determined.

---

## Canonical `AgentEvidencePacket`

Every agent persists one artifact per run with this top-level shape:

```json
{
  "artifact_id": "uuid",
  "session_id": "uuid | null",
  "patient_id": "uuid",
  "agent_name": "fall_risk_agent",
  "artifact_version": "1.0",
  "created_at": "2026-04-25T12:00:00Z",
  "source_type": "pt_session | progress_rollup",
  "upstream_artifact_ids": ["uuid1", "uuid2"],
  "data_coverage": {
    "required_fields_present": true,
    "missing_fields": [],
    "notes": []
  },
  "metrics": {},
  "claims": [],
  "narrative": {
    "summary": "",
    "highlights": [],
    "recommendations": []
  },
  "provenance": {
    "session_ids_used": ["uuid"],
    "raw_sources": ["pose_frames", "session_scores", "rep_analyses"],
    "rag_used": false,
    "rag_query": "",
    "rag_sources": []
  }
}
```

`metrics` content is agent-specific and defined in the per-agent contracts below.

---

## New DB Table: `agent_artifacts`

```sql
CREATE TABLE agent_artifacts (
    id                         VARCHAR(36) PRIMARY KEY,
    session_id                 VARCHAR(36) REFERENCES sessions(id)  NULL,
    patient_id                 VARCHAR(36) REFERENCES patients(id)  NULL,
    agent_name                 VARCHAR(64) NOT NULL,
    artifact_kind              VARCHAR(64) NOT NULL,
    artifact_json              JSON        NOT NULL,
    created_at                 DATETIME    NOT NULL,
    upstream_artifact_ids_json JSON        NOT NULL DEFAULT '[]',
    data_coverage_json         JSON        NOT NULL DEFAULT '{}'
);
```

Indexes required:
- `(session_id, agent_name)` — fetch an agent's artifact for a given session
- `(patient_id, agent_name, created_at)` — longitudinal history per agent per patient

---

## Shared Utility: `utils/artifacts.py`

New module. Single public function:

```python
async def write_artifact(
    agent_name: str,
    session_id: str | None,
    patient_id: str,
    artifact_kind: str,
    artifact_json: dict,
    upstream_artifact_ids: list[str],
    data_coverage: dict,
    db: AsyncSession,
) -> str:  # returns artifact_id
```

**Idempotency rule**: before inserting, check for an existing row with the same
`(session_id, agent_name)`. If found, return its `id` without inserting a
duplicate. This protects against pipeline retries.

---

## Per-Agent Data Contracts

### `intake_agent`

**Inputs (from `POST /sessions/{id}/end` HTTP body)**
- `pt_plan: str` — free-text clinical plan
- `pain_scores: dict` — `{"joint_name": 0–10}` from the mobile app
- `user_input: str` — patient's subjective report

**Also reads from DB**
- `Patient.metadata_json` — demographics plus, once the front-end provides them,
  clinical fields: `injured_joints`, `injured_side`, `rehab_phase`,
  `diagnosis`, `contraindications` (see `FRONTEND_DATA_REQUIREMENTS.md`)

**Output (new fields added to `IntakeOutput`)**

| Field | Source | Notes |
|---|---|---|
| `normalized_pain_scores` | LLM from `pain_scores` + `pt_plan` | already exists |
| `target_joints` | LLM from `pt_plan` | already exists |
| `session_goals` | LLM from `pt_plan` + `user_input` | already exists |
| `injured_joints` | `metadata_json` if present, else `[]` | new |
| `injured_side` | `metadata_json` if present, else `"unknown"` | new |
| `rehab_phase` | `metadata_json` if present, else `"unknown"` | new |
| `contraindications` | `metadata_json` if present, else `[]` | new |
| `data_confidence` | `"explicit"` / `"inferred"` / `"missing"` | new |

`data_confidence` is `"explicit"` when clinical fields came from `metadata_json`,
`"inferred"` when guessed from `pt_plan` text by the LLM, `"missing"` when no
source was available.

**Artifact `metrics` block**
```json
{
  "pain_scores": {"left_knee": 4, "right_hip": 2},
  "target_joint_count": 2,
  "injured_joints": ["left_knee"],
  "injured_side": "left",
  "rehab_phase": "sub-acute",
  "contraindications": ["deep squat"],
  "data_confidence": "explicit"
}
```

---

### `pose_analysis_agent`

**Inputs (reads from DB)**
- `PoseFrame` rows for the session, ordered by timestamp

**Output (new fields added to `PoseAnalysisOutput`)**

| Field | Notes |
|---|---|
| `rom_score` | already exists |
| `joint_stats` | already exists — `{joint: {mean, min, max, std, rom}}` |
| `flagged_joints` | already exists |
| `frame_count` | new — total frames analysed |
| `joint_coverage` | new — `{joint: frame_count}` for each joint seen |

**Artifact `metrics` block**
```json
{
  "rom_score": 64.5,
  "frame_count": 240,
  "joint_coverage": {"knee_flexion": 240, "hip_flexion": 230},
  "joint_stats": {
    "knee_flexion": {"mean": 45.2, "min": 12.0, "max": 95.0, "std": 18.3, "rom": 83.0}
  },
  "flagged_joints": ["knee_flexion"]
}
```

---

### `fall_risk_agent`

**Inputs (passed from orchestrator)**
- `intake: dict` — `IntakeOutput` (with new fields from Phase 4)
- `pose: dict` — `PoseAnalysisOutput`
- RAG — Chroma clinical guidelines

**Output (new fields added to `FallRiskOutput`)**

| Field | Notes |
|---|---|
| `score` | already exists |
| `risk_level` | already exists |
| `reasoning` | already exists |
| `contributing_factors` | already exists |
| `rag_used` | new — `bool` |
| `rag_sources` | new — `list[str]` document titles / chunk IDs |

**RAG gating rule**
- If Chroma returns 0 chunks: `rag_used=false`; remove guideline language from
  the LLM prompt; add `"no guideline context retrieved"` to `data_coverage.notes`
- If chunks returned: `rag_used=true`, populate `rag_query` and `rag_sources`

**Artifact `metrics` block**
```json
{
  "score": 42.0,
  "risk_level": "medium",
  "contributing_factors": ["knee_flexion ROM below 40% of expected", "pain 7/10"],
  "rag_used": true,
  "rag_sources": ["STEADI_fall_risk_2024.pdf chunk 3"]
}
```

`upstream_artifact_ids`: intake artifact ID + pose artifact ID for this session.

---

### `reinjury_risk_agent`

**Current problem**

The agent queries `SessionScore` (one aggregate float per session). It cannot
say which joint is driving a trend or whether the trend is data-sufficient.

**New inputs — all queried from DB by the agent itself**

1. **Prior pose artifacts** (`agent_artifacts` table)
   Query: `agent_name="pose_analysis_agent"`, `patient_id=patient_id`, last 5 by
   `created_at`. Extract per-joint `rom` values for the patient's `injured_joints`.

   `injured_joints` source priority:
   - `Patient.metadata_json.injured_joints` if present
   - Else: union of `flagged_joints` across the last 3 pose artifacts

2. **`RepAnalysis` rows for exercise sessions**
   If the patient has recent exercise sessions, query `RepAnalysis` for the
   biomechanical features relevant to the injured joint using a static lookup:

   | Injured joint keyword | RepAnalysis columns to read |
   |---|---|
   | `knee` | `knee_flexion_deg`, `fppa_peak`, `rom_ratio`, `knee_valgus` |
   | `hip` | `hip_adduction_peak`, `pelvic_drop_peak`, `hip_adduction` |
   | `ankle` | use ROM from pose artifacts (no dedicated RepAnalysis column) |
   | `shoulder` | use ROM from pose artifacts |

   Match is case-insensitive substring of the joint name (e.g. `"left_knee"` →
   matches `"knee"` row in table above).

3. **`SessionScore` rows** — last 5, aggregate trend (unchanged from current)

**Output (new fields added to `ReinjuryRiskOutput`)**

| Field | Notes |
|---|---|
| `score` | already exists |
| `trend` | already exists — aggregate direction |
| `reasoning` | already exists |
| `sessions_used` | new — how many prior sessions had joint ROM data |
| `data_sufficient` | new — `true` if `sessions_used >= 3` |
| `injured_joint_trend` | new — per-joint direction and supporting values |

**`injured_joint_trend` structure**
```json
{
  "left_knee_flexion": {
    "direction": "worsening",
    "rom_values": [83, 79, 71, 65],
    "delta_vs_earliest": -18,
    "range_pct_delta": 0.28
  }
}
```

**Threshold for "worsening" / "improving"**

Uses relative thresholds based on the patient's own score history:

1. Compute `score_range = max(rom_values) - min(rom_values)` across all available
   sessions for that joint.
2. A session-over-session delta is salient if `abs(delta) >= 0.20 * score_range`.
3. A direction requires ≥ 3 consecutive sessions with consistent delta sign.
4. If `sessions_used < 3`: set `data_sufficient=false`, set
   `injured_joint_trend={}`, note in `data_coverage.notes`.

**Artifact `metrics` block**
```json
{
  "score": 55.0,
  "trend": "worsening",
  "sessions_used": 4,
  "data_sufficient": true,
  "injured_joint_trend": {
    "left_knee_flexion": {
      "direction": "worsening",
      "rom_values": [83, 79, 71, 65],
      "delta_vs_earliest": -18,
      "range_pct_delta": 0.28
    }
  }
}
```

`upstream_artifact_ids`: the pose artifact IDs for the sessions whose joint ROM
values were used.

**Dependency**: Phase 2 requires Phase 1 to be complete so that prior pose
artifacts exist in `agent_artifacts`.

---

### `reporter_agent`

**Inputs (passed from orchestrator — unchanged)**
- `intake: dict`, `pose: dict`, `fall_risk: dict`, `reinjury_risk: dict`
- Last 3 `Summary(agent_name="reporter")` rows from DB

**Output (new field added to `ReporterOutput`)**

| Field | Notes |
|---|---|
| `summary` | already exists |
| `session_highlights` | already exists |
| `recommendations` | already exists |
| `evidence_map` | new — maps each report section to the specific metrics that support it |

**`evidence_map` structure**
```json
{
  "fall_risk_section": ["fall_risk_score=42", "fppa_peak_mean=9.1"],
  "reinjury_risk_section": ["left_knee_flexion ROM declining over 4 sessions"],
  "recommendations_section": ["knee_flexion ROM below 40% of expected", "pain=7/10"]
}
```

The LLM prompt must be updated to return `evidence_map` as part of the required
JSON output schema.

**Artifact `metrics` block**
```json
{
  "session_id": "uuid",
  "fall_risk_score": 42.0,
  "reinjury_risk_score": 55.0,
  "rom_score": 64.5,
  "pain_avg": 4.5,
  "evidence_map": { "..." }
}
```

`upstream_artifact_ids`: fall_risk artifact ID + reinjury_risk artifact ID for
this session.

---

### `progress_agent` — Four-Layer Redesign

**Current problem**: receives only prose summaries + two aggregate floats. The
LLM rewrites everything from scratch each time with no traceability.

**New design**: four deterministic stages before the LLM writes a single word.

---

#### Layer 1: Longitudinal fact builder — `build_patient_timeline()`

Queries, all ordered chronologically:
- `session_scores` — `fall_risk_score`, `reinjury_risk_score`, `pain_score`,
  `rom_score` per session
- `agent_artifacts` where `agent_name IN ("pose_analysis_agent",
  "reinjury_risk_agent", "reporter_agent")` and `patient_id = patient_id`
- `summaries` where `agent_name="reporter"` — prose for LLM reference
- `Patient.metadata_json` — `injured_joints`, `rehab_phase` if present
- `exercise_sessions` linked to each session — to set `source_type`

Produces a `PatientTimeline` object:

```python
@dataclass
class SessionFact:
    session_id: str
    created_at: datetime
    source_type: str              # "pt_session" | "exercise_session"
    scores: dict                  # {fall_risk, reinjury_risk, pain, rom}
    injured_joint_rom: dict       # {joint_name: rom_value} from pose artifact
    flagged_joints: list[str]     # from pose artifact
    data_sufficient: bool         # from reinjury artifact
    reporter_summary: str         # from summaries table
    evidence_map: dict            # from reporter artifact

@dataclass
class PatientTimeline:
    sessions: list[SessionFact]
    injured_joints: list[str]
    rehab_phase: str
```

`source_type` is `"exercise_session"` if the session has a linked
`ExerciseSession` row; `"pt_session"` otherwise.

---

#### Layer 2: Salience selector — `compute_salience()`

Runs before any LLM call. Identifies which sessions and metrics warrant
reporting using only arithmetic — no LLM.

**Relative threshold algorithm**

For each metric (`fall_risk_score`, `reinjury_risk_score`, `pain_score`,
`rom_score`, and per injured-joint ROM values):

1. Compute `score_range = max_value - min_value` across all sessions.
   If `score_range == 0`, the metric produces no salience signal.

2. A consecutive-session delta is **salient** if:
   `abs(delta) >= 0.20 * score_range`

3. A **sustained trend** is salient if:
   - ≥ 3 consecutive sessions show the same direction of change
   - AND cumulative delta across those sessions exceeds `0.20 * score_range`

4. **Goal and milestone signals** remain LLM-determined from reporter summaries.
   No structured goal-completion logic is added.

5. A **missing-data warning** is emitted for sessions where:
   - `SessionFact.data_sufficient == False`
   - Reporter artifact has non-empty `data_coverage.missing_fields`

**Output**

```python
@dataclass
class SalienceReport:
    salient_session_ids: list[str]
    salient_metrics: dict         # {metric: {direction, delta, session_ids, why}}
    salient_summaries: list[str]  # reporter summary text for salient sessions only
    data_warnings: list[str]
    why_selected: dict            # {session_id: human-readable reason string}
```

---

#### Layer 3: Constrained LLM report writer

The LLM receives **only** the `SalienceReport` — not all summaries, not all
artifacts. Inputs:
- `SalienceReport.salient_metrics` and `why_selected`
- Selected reporter summary texts (`salient_summaries`)
- `PatientTimeline.injured_joints` and `rehab_phase`
- Numeric snapshot of salient sessions (scores only, no raw frames)

Prompt constraints:
- Cite only evidence present in `SalienceReport`
- Do not infer causes not in the data
- Explicitly name any `data_warnings`
- Return structured JSON including `evidence_citations` per section

LLM output schema:
```json
{
  "longitudinal_report": "...",
  "overall_trend": "improving | stable | declining",
  "milestones_reached": ["..."],
  "next_goals": ["..."],
  "evidence_citations": {
    "trend_section": ["session_id ROM +18% over sessions 3–5"],
    "milestone_section": ["..."],
    "recommendation_section": ["..."]
  }
}
```

---

#### Layer 4: Progress artifact

Persists an `AgentEvidencePacket` containing:
- `session_ids_used` — salient sessions only
- `metrics_used` — the `SalienceReport.salient_metrics` block
- `summaries_used` — which reporter Summary IDs were included
- `evidence_citations` — the LLM's own citations

---

## RAG Gating

Applies to `fall_risk_agent` (currently uses RAG). Pattern for any future agent
that adds RAG.

Change `rag/retriever.py` to return a structured result instead of a bare string:

```python
@dataclass
class RagResult:
    context: str
    sources: list[str]   # document titles or chunk IDs
    hit_count: int
```

Callers gate on `hit_count == 0`:
- If 0: set `rag_used=false` in artifact; remove guideline language from prompt;
  add note to `data_coverage.notes`
- If > 0: set `rag_used=true`; populate `rag_query` and `rag_sources`

---

## Implementation Phases

### Phase 1 — Artifact persistence (no behavior change)

**Goal**: Every agent writes a durable artifact. Nothing downstream changes yet.

**New files**
- `db/migrations/xxxx_add_agent_artifacts.py` — Alembic migration for
  `agent_artifacts` table (columns and indexes as defined above)
- `utils/artifacts.py` — `write_artifact()` with idempotency check

**Changed files**

| File | Change |
|---|---|
| `db/models.py` | Add `AgentArtifact` ORM model |
| `rag/retriever.py` | Return `RagResult` instead of bare `str` |
| `agents/intake.py` | Call `write_artifact` at end of `run_intake` |
| `agents/pose_analysis.py` | Add `frame_count`, `joint_coverage` to output; call `write_artifact` |
| `agents/fall_risk.py` | Capture `rag_used` + `rag_sources` from `RagResult`; call `write_artifact` |
| `agents/reinjury_risk.py` | Call `write_artifact` |
| `agents/reporter.py` | Update LLM prompt to return `evidence_map`; call `write_artifact` |
| `agents/progress.py` | Call `write_artifact` |
| `schemas/session.py` | Add `frame_count`, `joint_coverage` to `PoseAnalysisOutput`; add `rag_used`, `rag_sources` to `FallRiskOutput`; add `evidence_map` to `ReporterOutput` |
| `agents/messages.py` | Mirror the above schema additions in message models |

**Outcome**: All agents produce durable artifacts. Behavior is identical to today.

---

### Phase 2 — Reinjury risk reads joint history from artifacts

**Goal**: `reinjury_risk_agent` grounds its assessment in per-joint ROM history,
not just aggregate session scores.

**Dependency**: Phase 1 complete (pose artifacts exist in DB).

**Changed files**

| File | Change |
|---|---|
| `agents/reinjury_risk.py` | Replace `SessionScore`-only query with three queries: (1) prior pose artifacts for injured joints, (2) `RepAnalysis` rows for exercise sessions using the joint→feature lookup table, (3) existing `SessionScore` aggregate; compute `injured_joint_trend` deterministically; set `data_sufficient` |
| `schemas/session.py` | Add `sessions_used`, `data_sufficient`, `injured_joint_trend` to `ReinjuryRiskOutput` |
| `agents/messages.py` | Add new fields to `ReinjuryRiskResponse` |

**Outcome**: Reinjury risk is grounded in specific joint-level history. The
`data_sufficient` flag surfaces to the reporter and progress layers.

---

### Phase 3 — Progress agent four-layer redesign

**Goal**: Progress report is built from structured evidence, not prose.

**Dependency**: Phase 1 complete (reporter artifacts with `evidence_map` exist).

**New files**
- `agents/progress_salience.py` — two pure async functions:
  - `build_patient_timeline(patient_id: str, db: AsyncSession) -> PatientTimeline`
  - `compute_salience(timeline: PatientTimeline) -> SalienceReport`
  Both are standalone and testable without an LLM.

**Changed files**

| File | Change |
|---|---|
| `agents/progress.py` | Replace current single-query/prompt with four-layer sequence: call `build_patient_timeline`, call `compute_salience`, build constrained prompt from `SalienceReport`, write artifact with `evidence_citations` |
| `schemas/session.py` | Add `evidence_citations: dict` to `ProgressOutput` |

**Outcome**: Every claim in a progress report is traceable to specific sessions
and metrics. The LLM receives only salient evidence and produces fewer
unsupported claims.

---

### Phase 4 — Intake enrichment from patient metadata

**Goal**: Intake reads clinical fields from `Patient.metadata_json` when present,
rather than inferring everything from `pt_plan` text.

**Dependency**: Partially unblocked now. The intake agent can be updated
immediately. Richer outputs will follow automatically as the front-end starts
sending clinical metadata.

**Changed files**

| File | Change |
|---|---|
| `agents/intake.py` | Load `Patient.metadata_json`; extract clinical fields; set `data_confidence`; update LLM prompt to use or guess missing clinical fields |
| `schemas/session.py` | Add `injured_joints`, `injured_side`, `rehab_phase`, `contraindications`, `data_confidence` to `IntakeOutput` |
| `agents/messages.py` | Update `IntakeResponse` |
| `agents/fall_risk.py` | Read `injured_joints` and `rehab_phase` from intake artifact and pass into the fall risk LLM prompt |

**Outcome**: When clinical metadata is present, all downstream agents have
explicit injury context. When absent, behavior degrades gracefully with
`data_confidence="missing"` recorded in the artifact.
