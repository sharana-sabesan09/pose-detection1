# Agent Architecture

Date: 2026-04-25  
Status: current implementation

---

## Overview

Two independent clinical pipelines share the same database and agent codebase.

| Pipeline | Trigger | Agents |
|---|---|---|
| PT session | `POST /sessions/{id}/end` | intake → pose_analysis → fall_risk + reinjury_risk → reporter → progress |
| Exercise | `POST /sessions/exercise-result` | exercise_reporter → progress |

The PT pipeline runs synchronously inside the HTTP request. The exercise pipeline runs as a background task after the 201 response. Both write to the same `session_scores`, `summaries`, and `agent_artifacts` tables, so `progress_agent` sees longitudinal data from both paths.

---

## PT Session Pipeline

```
POST /sessions/{id}/end
        │
        ▼
┌─────────────┐
│   intake    │  reads Patient.metadata_json for clinical fields
│    agent    │  LLM normalises pain_scores, extracts target_joints, session_goals
└──────┬──────┘
       │  IntakeOutput  (+ injured_joints, rehab_phase, data_confidence)
       │  writes ── agent_artifacts (intake_agent)
       ▼
┌──────────────────┐
│  pose_analysis   │  reads PoseFrame rows for session
│     agent        │  deterministic: joint_stats, flagged_joints, frame_count, joint_coverage
└────────┬─────────┘
         │  PoseAnalysisOutput
         │  writes ── agent_artifacts (pose_analysis_agent)
         ▼
┌────────────────────────────────────────────────────────┐
│                     sequential                          │
│  ┌──────────────┐           ┌──────────────────────┐   │
│  │  fall_risk   │           │   reinjury_risk       │   │
│  │    agent     │           │      agent            │   │
│  │              │           │                       │   │
│  │ RAG → LLM    │           │ [1] pose artifacts    │   │
│  │ gates on     │           │     (per-joint ROM    │   │
│  │ hit_count    │           │      history)         │   │
│  │              │           │ [2] RepAnalysis rows  │   │
│  │ writes ──    │           │     (exercise feats)  │   │
│  │ agent_artif. │           │ [3] SessionScore agg  │   │
│  └──────────────┘           │                       │   │
│                             │ deterministic trend   │   │
│                             │ writes ── agent_artif.│   │
│                             └──────────────────────┘   │
│  (same db session, cannot run concurrently)             │
└──────────────────────────────┬─────────────────────────┘
                               │
                               ▼
                      ┌────────────────┐
                      │    reporter    │  LLM gets all upstream outputs
                      │     agent      │  returns evidence_map
                      │                │  writes Summary + SessionScore
                      │                │  writes ── agent_artifacts (reporter_agent)
                      └───────┬────────┘
                              │
                              ▼  (only if patient has ≥ 3 sessions)
                      ┌────────────────┐
                      │    progress    │  four-layer (see below)
                      │     agent      │
                      └────────────────┘
```

---

## Exercise Pipeline

```
POST /sessions/exercise-result
        │ (FastAPI returns 201 immediately)
        │ background task →
        ▼
┌──────────────────────┐
│  exercise_reporter   │  native ExerciseSessionResult — no intake or pose_analysis
│       agent          │  deterministic scoring (ROM, fall_risk, reinjury_risk scores)
│                      │  RAG query keyed on dominant errors
│                      │  writes Summary(agent_name="reporter")
│                      │  writes SessionScore
└──────────┬───────────┘
           │
           ▼  (only if patient has ≥ 3 linked sessions)
   ┌────────────────┐
   │    progress    │
   │     agent      │
   └────────────────┘
```

Exercise sessions write `Summary(agent_name="reporter")` and `SessionScore`, so `progress_agent` sees them alongside PT sessions in `build_patient_timeline`.

---

## Per-Agent Reference

### `intake_agent`

**File:** `agents/intake.py`

**Inputs**
- HTTP body: `IntakeInput` — `pt_plan`, `pain_scores`, `user_input`, `session_type`
- DB: `Patient.metadata_json` — clinical fields if set by the front-end

**Deterministic pre-LLM**
- Reads `injured_joints`, `injured_side`, `rehab_phase`, `diagnosis`, `contraindications`, `restrictions` from `metadata_json`
- Sets `data_confidence`:
  - `"explicit"` — clinical fields came from `metadata_json`
  - `"inferred"` — no clinical metadata but `pt_plan` is non-empty
  - `"missing"` — no metadata, no plan

**LLM call**
Returns `normalized_pain_scores`, `target_joints`, `session_goals`

**Output: `IntakeOutput`**
```
normalized_pain_scores  dict
target_joints           list[str]
session_goals           list[str]
session_type            str              copied from input
injured_joints          list[str]        from metadata or []
injured_side            str              from metadata or "unknown"
rehab_phase             str              from metadata or "unknown"
contraindications       list[str]        from metadata or []
data_confidence         str
```

**Artifact metrics block**
```json
{
  "pain_scores": {"knee_flexion": 4},
  "target_joint_count": 2,
  "injured_joints": ["knee_flexion"],
  "injured_side": "left",
  "rehab_phase": "sub-acute",
  "contraindications": [],
  "data_confidence": "explicit"
}
```

---

### `pose_analysis_agent`

**File:** `agents/pose_analysis.py`

**Inputs**
- DB: `PoseFrame` rows for the session, ordered by timestamp

**Entirely deterministic — no LLM**
- Per-joint: `mean`, `min`, `max`, `std`, `rom`
- ROM deficiency flag: joint range < 40% of `_EXPECTED_ROM[joint]`
- Error-excess flag: max value exceeds `_ERROR_THRESHOLDS[joint]`
- ROM score: `mean(all_rom_contributions) / mean(_EXPECTED_ROM.values()) * 100`, clamped at 100

**Output: `PoseAnalysisOutput`**
```
rom_score       float
joint_stats     dict   {joint: {mean, min, max, std, rom}}
flagged_joints  list[str]
frame_count     int
joint_coverage  dict   {joint: frame_count}
```

**Artifact metrics block**
```json
{
  "rom_score": 64.5,
  "frame_count": 240,
  "joint_coverage": {"knee_flexion": 240},
  "joint_stats": {"knee_flexion": {"mean": 45.2, "rom": 83.0}},
  "flagged_joints": ["knee_flexion"]
}
```

**Upstream artifact IDs:** none (reads raw frames, not other artifacts)

---

### `fall_risk_agent`

**File:** `agents/fall_risk.py`

**Inputs (from orchestrator)**
- `IntakeOutput` — including `injured_joints`, `rehab_phase`, `contraindications`
- `PoseAnalysisOutput`

**RAG gating**
- `retrieve_clinical_context()` returns `RagResult(context, sources, hit_count)`
- If `hit_count == 0`: guidelines block is replaced with a note; LLM prompt has no guideline language
- If `hit_count > 0`: guideline text prepended; `rag_used=True`, `rag_sources` populated

**LLM call**
Returns `score`, `risk_level`, `reasoning`, `contributing_factors`

**DB write:** `SessionScore.fall_risk_score`

**Output: `FallRiskOutput`**
```
score                float  0–100
risk_level           str    low | medium | high
reasoning            str    HIPAA-scrubbed
contributing_factors list[str]
rag_used             bool
rag_sources          list[str]
```

**Upstream artifact IDs:** `intake_agent` + `pose_analysis_agent` artifacts for this session

---

### `reinjury_risk_agent`

**File:** `agents/reinjury_risk.py`

**Inputs — three separate DB queries**

1. **Prior pose artifacts** (`agent_artifacts`, `agent_name="pose_analysis_agent"`)
   - Last 5 by `created_at` for this patient
   - Extracts `joint_stats[joint].rom` for each injured joint
   - `injured_joints` source priority: `Patient.metadata_json` → fallback to union of `flagged_joints` across last 3 pose artifacts

2. **RepAnalysis rows for exercise sessions**
   - Last 5 `ExerciseSession` rows by `created_at` for this patient
   - Static joint→feature lookup:

   | Injured joint keyword | RepAnalysis features used |
   |---|---|
   | `knee` | `knee_flexion_deg`, `fppa_peak`, `rom_ratio` |
   | `hip` | `hip_adduction_peak`, `pelvic_drop_peak` |
   | `ankle` | ROM from pose artifacts only |
   | `shoulder` | ROM from pose artifacts only |

3. **`SessionScore` aggregate** — last 5 sessions, `fall_risk_score` + `rom_score` trends (unchanged fallback)

**Deterministic trend computation**
- Per injured joint, collects chronological ROM values from pose artifacts
- Relative threshold: `0.20 × (max_rom − min_rom)` across all available sessions
- Sustained trend = ≥ 3 consecutive same-direction deltas above threshold
- `data_sufficient = sessions_with_data >= 3`

**LLM call**
Returns `score`, `trend`, `reasoning`

**DB write:** `SessionScore.reinjury_risk_score`

**Output: `ReinjuryRiskOutput`**
```
score                 float  0–100
trend                 str    improving | stable | worsening
reasoning             str    HIPAA-scrubbed
sessions_used         int
data_sufficient       bool
injured_joint_trend   dict   {joint: {direction, rom_values, delta_vs_earliest, range_pct_delta}}
```

**Upstream artifact IDs:** pose artifact IDs whose ROM values were used

---

### `reporter_agent`

**File:** `agents/reporter.py`

**Inputs (from orchestrator)**
- `IntakeOutput`, `PoseAnalysisOutput`, `FallRiskOutput`, `ReinjuryRiskOutput`
- DB: last 3 `Summary(agent_name="reporter")` rows for the patient

**LLM call**
Returns `summary`, `session_highlights`, `recommendations`, `evidence_map`

`evidence_map` maps each report section to the specific measurements that drove it:
```json
{
  "fall_risk_section": ["Fall risk=70.0", "fppa_peak=9.1"],
  "reinjury_risk_section": ["left_knee_flexion ROM declining over 3 sessions"],
  "recommendations_section": ["knee_flexion ROM below 40% of expected"]
}
```

**DB writes:** `Summary(agent_name="reporter")` + `SessionScore.pain_score` + `SessionScore.rom_score`

**Output: `ReporterOutput`**
```
summary             str    HIPAA-scrubbed
session_highlights  list[str]
recommendations     list[str]
evidence_map        dict
```

**Upstream artifact IDs:** `fall_risk_agent` + `reinjury_risk_agent` artifacts for this session

---

### `progress_agent` — four-layer design

**File:** `agents/progress.py`  
**Helper module:** `agents/progress_salience.py`

**Trigger:** runs at end of both PT and exercise pipelines, only when `session_count >= 3`

#### Layer 1 — `build_patient_timeline(patient_id, db) → PatientTimeline`

Queries:
- All `Session` rows for patient, chronological
- `SessionScore` — all scores indexed by session_id
- `AgentArtifact` for `agent_name IN ("pose_analysis_agent", "reinjury_risk_agent", "reporter_agent")`
- `Summary(agent_name="reporter")` — text for salient summaries
- `Patient.metadata_json` — `injured_joints`, `rehab_phase`
- `ExerciseSession.linked_session_id` — to set `source_type`

Produces per-session `SessionFact`:
```python
session_id, created_at, source_type    # "pt_session" | "exercise_session"
scores                                  # {fall_risk, reinjury_risk, pain, rom}
injured_joint_rom                       # {joint: rom} from pose_analysis_agent artifact
flagged_joints                          # from pose_analysis_agent artifact
data_sufficient                         # from reinjury_risk_agent artifact
reporter_summary                        # from summaries table
evidence_map                            # from reporter_agent artifact
```

#### Layer 2 — `compute_salience(timeline) → SalienceReport`

No LLM. Pure arithmetic.

For each metric (`fall_risk_score`, `reinjury_risk_score`, `pain_score`, `rom_score`, per-joint ROM):
1. `score_range = max − min` across all sessions; if 0, metric is skipped
2. A session-over-session delta is **salient** if `|delta| >= 0.20 × score_range`
3. A **sustained trend** is identified if ≥ 3 consecutive same-direction salient deltas

Also: most recent session is always included.

Outputs `SalienceReport`:
```python
salient_session_ids    list[str]
salient_metrics        dict    {metric: {direction, values, delta_vs_baseline, score_range}}
salient_summaries      list[str]    reporter text for salient sessions only
data_warnings          list[str]    surfaced to LLM
why_selected           dict    {session_id: human-readable reason}
```

#### Layer 3 — Constrained LLM call

LLM receives **only** the `SalienceReport` — not all summaries, not all artifacts.

Prompt constraints:
- Cite only session IDs and metrics from `salient_metrics`
- Acknowledge all `data_warnings` explicitly
- No patient names or identifiers

Required JSON output:
```json
{
  "longitudinal_report": "...",
  "overall_trend": "improving | stable | declining",
  "milestones_reached": ["..."],
  "next_goals": ["..."],
  "evidence_citations": {
    "trend_section": ["session_id X: metric Y changed by Z"],
    "milestone_section": [],
    "recommendation_section": []
  }
}
```

#### Layer 4 — Artifact

Writes to `agent_artifacts` (`agent_name="progress_agent"`, `session_id=None`).

Stores `salient_session_ids`, `metrics_used`, `evidence_citations`, `data_warnings` as
the permanent provenance record for this progress report.

**DB writes:** `Summary(agent_name="progress", session_id=None)` + `AccumulatedScore` (weighted avg of last 10 sessions)

---

### `exercise_reporter_agent`

**File:** `agents/exercise_reporter.py`  
**Scope:** out of scope for current architecture refinement (Med Gemma pipeline planned)

Receives `ExerciseSessionResult` natively. No intake or pose_analysis agent involved.

Deterministic scoring:
- ROM score: `romRatio_mean × 100`
- Fall risk: `swayNorm` (40 pts) + `pelvicDropPeak` (30 pts) + `balance_error_rate` (30 pts)
- Reinjury risk: `(1 − consistency) × 50` + `mean_error_rate × 30` + `poor_rep_rate × 20`

Writes `Summary(agent_name="reporter")` and `SessionScore`, bridging exercise data into the progress and reinjury pipelines.

**Does not write to `agent_artifacts`.** (see issues)

---

### `patient_advisor_agent`

**File:** `agents/patient_advisor.py`

On-demand question answering via `POST /patients/{id}/advice`.

Reads patient metadata, last 5 sessions, scores, accumulated scores, and RAG context. Conservative: no diagnosis, flags urgent symptoms, writes audit trail.

---

## Artifact Data Flow

```
Session N (PT)
  intake_agent ─────────────────────────────────► agent_artifacts[intake_agent, session_N]
  pose_analysis_agent ──────────────────────────► agent_artifacts[pose_analysis_agent, session_N]
  fall_risk_agent ──── upstream: [intake, pose] ► agent_artifacts[fall_risk_agent, session_N]
  reinjury_risk_agent ─ upstream: [pose artifacts from last 5 sessions]
                      ──────────────────────────► agent_artifacts[reinjury_risk_agent, session_N]
  reporter_agent ──── upstream: [fall_risk, reinjury_risk]
                      ──────────────────────────► agent_artifacts[reporter_agent, session_N]

Session N+3 (progress trigger)
  progress_agent
    ├── reads all pose_analysis_agent artifacts → per-joint ROM timeline
    ├── reads all reinjury_risk_agent artifacts → data_sufficient flags
    ├── reads all reporter_agent artifacts → evidence_maps
    └── writes ────────────────────────────────► agent_artifacts[progress_agent, session_id=NULL]
```

The idempotency key for session-scoped artifacts is `(session_id, agent_name)`.  
The progress artifact uses `session_id=NULL` (patient-level) — **see Issue 1**.

---

## Known Issues

### Issue 1 — Progress artifact has no idempotency (high)

`write_artifact` gates idempotency on `if session_id:` — if `session_id` is `None`, the check is skipped and a new row is always inserted. `progress_agent` calls `write_artifact(session_id=None, ...)`. Every progress run inserts a new artifact for the same patient. After 100 sessions the patient will have 100 `progress_agent` artifact rows with no deduplication.

**Fix:** add a secondary idempotency path in `write_artifact`:
```python
# For patient-level artifacts (session_id=None), gate on (patient_id, agent_name, date)
# or limit to "latest artifact per (patient_id, agent_name)" and upsert.
```

---

### Issue 2 — exercise_reporter is outside the artifact system (high)

`exercise_reporter_agent` writes `Summary` and `SessionScore` but **does not** call `write_artifact`. Consequences:

- `build_patient_timeline` sets `injured_joint_rom={}` and `evidence_map={}` for all exercise sessions — the salience selector has no per-joint data for them.
- `reinjury_risk_agent`'s Phase 2 query looks for `pose_analysis_agent` artifacts. Exercise sessions never produce these, so joint ROM history can only come from PT sessions.
- Progress reports for exercise-only patients contain only aggregate scores, not joint trends.

**Fix:** Write a synthetic `pose_analysis_agent` artifact from the RepAnalysis means at the end of `run_exercise_reporter`, mapping `knee_flexion_deg` → `joint_stats.knee_flexion.rom`, etc.

---

### Issue 3 — `demographicRiskScore` is collected but not used (medium)

`Patient.metadata_json` always stores `demographicRiskScore` (mobile-computed). `fall_risk_agent` never reads it. Age, BMI, and gender are established fall-risk components and could improve the LLM's starting estimate without any new data collection.

**Fix:** in `run_fall_risk`, read `patient.metadata_json.demographicRiskScore` (and `age`, `bmi`) and include in the LLM prompt alongside the session measurements.

---

### Issue 4 — `reinjury_risk` data_sufficient uses the max across joints, not the primary joint (medium)

```python
sessions_with_data = max(sessions_with_data, len(rom_values))
```

If a patient has 5 sessions of knee ROM data and 1 session of hip ROM data, `data_sufficient=True`. But for the hip joint the trend is actually insufficient. The data quality flag is inflated.

**Fix:** compute `data_sufficient` per joint:
```python
injured_joint_trend[joint]["data_sufficient"] = len(rom_values) >= 3
```
and set the top-level `data_sufficient` only when ALL tracked injured joints have ≥ 3 sessions.

---

### Issue 5 — reporter still calls RAG but does not gate on `hit_count` (medium)

`reporter_agent` calls `retrieve_clinical_context` but uses `clinical_context` in the prompt without checking `hit_count`. When ChromaDB has no guidelines, the prompt includes an empty "No relevant guidelines found." line. This wastes tokens and could confuse the LLM.

**Fix:** mirror the `fall_risk_agent` pattern:
```python
rag_result = await retrieve_clinical_context(query)
if rag_result.hit_count > 0:
    # prepend guideline block
```

---

### Issue 6 — `session_type` does not affect progress weighting (medium)

Assessment sessions are meant to be baseline anchors (noted in `FRONTEND_DATA_REQUIREMENTS.md`). `compute_salience` currently treats all session types equally. A session with `session_type="assessment"` that has dramatically different scores than treatment sessions will drive spurious salience signals.

**Fix:** in `build_patient_timeline`, store `session_type` on `SessionFact`. In `compute_salience`, mark assessment sessions explicitly in `why_selected` and exclude them from delta calculations (they are baselines, not trend points).

---

### Issue 7 — `patient_advisor` and `exercise_reporter` do not benefit from RAG gating (low)

Both agents call `retrieve_clinical_context()` and use the result in an f-string. Since `RagResult.__str__` returns `self.context`, this works without error. But neither agent gates on `hit_count`, so the LLM receives an unhelpful "No relevant guidelines found." string instead of a clean prompt when ChromaDB is empty.

**Fix:** update both agents to check `rag_result.hit_count > 0` before including the guideline block.

---

### Issue 8 — agentverse_agent.py is not updated for new message fields (low)

`agents/agentverse_agent.py` dispatches `IntakeRequest`, `FallRiskRequest` etc. through `ctx.send()`. The new fields (`session_type`, `injured_joints`, `rag_used`, `data_sufficient`, etc.) are in the updated `agents/messages.py` models, but the agentverse dispatch code may not forward them. This is low priority because the HTTP path is the active production path, but it will cause silent data loss if the Agentverse path is activated.

**Fix:** audit `agentverse_agent.py` message construction against the current `messages.py` models.

---

### Issue 9 — No versioning on artifact JSON schema (low)

The architecture spec called for `artifact_version` in the `AgentEvidencePacket`. It was not added. If the `artifact_json` structure changes in a future release, `build_patient_timeline` will silently fail to find fields and return empty data (e.g. `injured_joint_rom = {}`).

**Fix:** add `"artifact_version": "1.0"` as a top-level field in all `artifact_json` payloads. Add a version check in `build_patient_timeline` when reading artifact data.

---

## Improvement Backlog (ranked by clinical value)

| Priority | Item | Agents affected | Effort |
|---|---|---|---|
| 1 | Fix progress artifact idempotency (Issue 1) | progress | Small |
| 2 | Write synthetic pose artifact from exercise_reporter (Issue 2) | exercise_reporter, reinjury_risk, progress | Medium |
| 3 | Add `demographicRiskScore` + `age` + `bmi` to fall_risk prompt (Issue 3) | fall_risk | Small |
| 4 | Per-joint `data_sufficient` in reinjury_risk (Issue 4) | reinjury_risk | Small |
| 5 | RAG gating in reporter + exercise_reporter + patient_advisor (Issue 5, 7) | reporter, exercise_reporter, patient_advisor | Small |
| 6 | Assessment session baseline anchoring (Issue 6) | progress_salience, progress | Medium |
| 7 | Pre-session vs post-session pain scores | intake, reporter, progress | Front-end + backend |
| 8 | Side-aware left/right split in exercise_reporter | exercise_reporter | Medium |
| 9 | Rehab phase transition detection in progress | progress | Medium |
| 10 | Artifact schema versioning (Issue 9) | all agents, progress_salience | Small |
| 11 | Audit agentverse_agent.py for new fields (Issue 8) | agentverse_agent | Small |

---

## Data Confidence Levels

Every artifact carries a `data_coverage` block:

```json
{
  "required_fields_present": true,
  "missing_fields": ["injured_joints"],
  "notes": ["data_confidence=inferred"]
}
```

Downstream consumers (`reporter`, `progress_salience`) should surface these notes rather than silently operating on incomplete data. Currently only `progress_agent` propagates `data_warnings` from `data_sufficient` and `reporter_summary` checks. The `data_coverage.notes` from intake and pose artifacts are not yet forwarded to the LLM.

---

## Artifact Lifecycle

```
Session ends
    │
    ▼ agent_artifacts rows written in same DB transaction as session data
    │   (flushed per-agent, committed once at end of pipeline)
    │
    ▼ next session's reinjury_risk_agent reads prior pose artifacts
    │
    ▼ progress_agent reads all artifacts for patient on trigger
    │
    ▼ progress artifact written (session_id=NULL — patient-level)
```

The single `db.commit()` at the end of `orchestrator.run_session_pipeline` means artifacts from a failed pipeline step are **not committed**. If fall_risk fails, no fall_risk artifact is written. The downstream reporter will not find it when calling `get_artifact_id(session_id, "fall_risk_agent")`, and the reporter's `upstream_artifact_ids` will be incomplete. This is correct and expected — the artifact reflects what actually ran, not what was planned.
