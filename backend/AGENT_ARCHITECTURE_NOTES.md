# Agent Architecture Notes

Analysis based on running `test_agents.py` against two real squat sessions:
- **message.txt** — 13 reps, session `2026-04-25T16:00:36`, ~38 s
- **message (1).txt** — 20 reps, session `2026-04-25T16:07:08`, ~40 s

Both sessions produced `overallRating: "poor"`. All reps across both sessions were classified `"poor"` except one `"fair"` rep in each session.

---

## Status of identified issues

| Issue | Status | Resolution |
|-------|--------|------------|
| Exercise data never reached agents | **Fixed** | `run_exercise_pipeline()` fires as background task after every `POST /sessions/exercise-result` |
| `exercise_sessions` → `SessionScore` bridge missing | **Fixed** | `exercise_reporter_agent` writes `SessionScore` with fall_risk, reinjury_risk, and rom scores |
| No rep quality filtering | **Fixed** | Reps with `confidence < 0.7` or `durationMs < 300 ms` excluded before any aggregation |
| `hipAdductionPeak == 0` sentinel not guarded | **Fixed** | `exclude_zero=True` in `feat_stats()` — landmark-loss sentinels excluded from all hip stats |
| `swayNorm` and `balance` not reaching fall risk | **Fixed** | `exercise_reporter_agent` derives `fall_risk_score` from swayNorm, pelvicDropPeak, and balance error rate |
| `consistency` not reaching reinjury risk | **Fixed** | `exercise_reporter_agent` derives `reinjury_risk_score` from consistency, mean error rate, poor-rep rate |
| Mobile app posted to dev-only `/exports/session` instead of DB ingest | **Fixed** | React Native app now requests a JWT then uploads directly to `POST /sessions/exercise-result` |
| Uploaded CSV artifacts never reached PostgreSQL | **Fixed** | `repsCsv` and `frameFeaturesCsv` are stored on `exercise_sessions` |
| Raw landmark CSV was incompatible with `pose_frames` ingestion | **Fixed** | Mobile app now uploads frame-feature CSV (`frame,timestamp,knee_flex,...`) and backend parses it into `pose_frames` |
| Production upload path lacked JWT auth | **Fixed** | React Native app now calls `POST /auth/token` before `POST /sessions/exercise-result` |
| Anonymous exercise uploads could not create linked sessions | **Fixed** | `sessions.patient_id` is now nullable, matching the exercise schema's optional `patientId` |
| Mobile users had no stable backend patient identity or patient-centric read model | **Fixed** | Intake now upserts `/patients/{patientId}`, session uploads reuse that ID, and the Results tab reads `/patients/{patientId}/overview` plus report endpoints |
| `pose_analysis_agent` duplicates mobile work | **Deferred** | Still used for PT frame sessions; only exercise path bypasses it |
| Agentverse path undocumented entry point | **Deferred** | HTTP pipeline is the active path; Agentverse remains optional |

---

## Current data pipeline (post-fix)

```
Mobile app                    Backend DB                    Agents
──────────                    ──────────                    ──────
POST /auth/token      ──▶   JWT
POST /sessions/exercise-result ──▶ exercise_sessions ──▶  exercise_reporter_agent
                                    rep_analyses           │  (filters reps, guards sentinels)
                                    pose_frames            │  writes Summary + SessionScore
                                    Session (linked)       │
                                                           └──▶ progress_agent (if ≥3 sessions)

POST /sessions/start ──▶   sessions
POST /sessions/frame ──▶   pose_frames          ──▶  pose_analysis_agent
POST /sessions/end   ──▶   session_scores       ──▶  intake → pose → fall_risk
                            summaries            ──▶  reinjury_risk → reporter → progress
```

The two paths now both write to `SessionScore` and `Summary`, so `reinjury_risk_agent` and `progress_agent` see longitudinal data from both exercise and PT sessions.

---

## exercise_reporter_agent (`agents/exercise_reporter.py`)

Replaces the intake → pose_analysis → fall_risk → reinjury_risk → reporter chain for exercise sessions. Takes `ExerciseSessionResult` natively.

### Rep quality filtering

```python
_MIN_CONFIDENCE = 0.7
_MIN_DURATION_MS = 300.0   # ms — anatomically impossible squats below this

good_reps = [r for r in all_reps
             if r.confidence >= _MIN_CONFIDENCE
             and r.timing.durationMs >= _MIN_DURATION_MS]
```

Reps 9–12 in `message (1).txt` (51–122 ms, confidence 0.62–0.63) are excluded before any stats are computed.

### `hipAdductionPeak == 0` guard

```python
def feat_stats(values, exclude_zero=False):
    clean = [v for v in values if v is not None
             and (not exclude_zero or v != 0.0)]
```

`hipAdductionPeak` is computed with `exclude_zero=True`. Reps where the MediaPipe hip landmark was lost contribute no data rather than pulling the mean toward 0°.

### Score derivation

| Score | Formula | Signals used |
|-------|---------|--------------|
| `rom_score` | `romRatio_mean × 100` (clamped 0–100) | Per-rep normalised depth |
| `fall_risk_score` | sway_component (40) + pelvic_component (30) + balance_component (30) | `swayNorm`, `pelvicDropPeak`, `balance` error rate |
| `reinjury_risk_score` | consistency_component (50) + error_component (30) + poor_component (20) | `consistency`, mean error rate across all types, poor-rep rate |

**Fall risk components:**
- `sway_component = min(1, swayNorm_mean / 0.05) × 40` — clinically, sway > 0.05 is significant
- `pelvic_component = min(1, pelvicDropPeak_mean / 20°) × 30` — clinically, > 10° is significant
- `balance_component = balance_error_rate × 30`

**Reinjury risk components:**
- `consistency_component = (1 − consistency) × 50` — low consistency = compensatory variance = elevated risk
- `error_component = mean_error_rate × 30`
- `poor_component = poor_rep_rate × 20`

### RAG query

Keyed on the dominant errors (those > 50% of good reps) so clinical guidelines retrieved are specific to the exercise and error pattern, e.g. `"squat exercise rehabilitation kneeValgus trunkFlex"`.

### DB writes

- `Summary(agent_name="reporter")` — progress_agent picks up these rows via its existing query (`WHERE agent_name = "reporter"`)
- `SessionScore` — fall_risk_score, reinjury_risk_score, rom_score — makes the session visible to `reinjury_risk_agent`'s trend query

---

## What the original agents receive vs. what the data contains

> The sections below describe the **PT frame pipeline** (`POST /sessions/end`), not the exercise pipeline. The exercise pipeline bypasses all of these agents.

### `intake_agent`

**Receives:** `pt_plan` (string), `pain_scores` (dict), `user_input` (string)

**Problem (unchanged):** None of these exist in the exercise session schema. `test_agents.py` derived `pain_scores` from error-flag frequencies — a fabrication. The agent is purpose-built for clinician-administered PT intake forms.

**Status:** Not used in the exercise pipeline.

---

### `pose_analysis_agent`

**Receives:** Raw `PoseFrame` rows with `angles_json`

**Problem (updated):** The exercise path now stores frame-feature rows in
`pose_frames`, but the exercise pipeline still bypasses `pose_analysis_agent`
because the native per-rep biomechanical features are richer than the ROM-only
summary this agent re-derives.

**Status:** Still used for the PT frame path (`POST /sessions/frame` + `POST /sessions/end`). Not used in the exercise pipeline.

---

### `fall_risk_agent`

**Problem (unchanged for PT path):** Receives synthesised pain scores and a three-joint ROM approximation. `swayNorm`, `balance`, and `pelvicDropPeak` never reach it via the PT path.

**Status:** PT path only. Exercise path uses `exercise_reporter_agent` which incorporates all three signals.

---

### `reinjury_risk_agent`

**Problem (unchanged for PT path):** Reads `SessionScore` rows — now populated by both pipelines. For exercise-only patients, the trend query will return data after the first exercise session runs through `exercise_reporter_agent`.

**Status:** PT path only, but now benefits from exercise-session `SessionScore` rows written by the exercise pipeline.

---

### `reporter_agent`

**Problem (unchanged for PT path):** Receives the synthesised chain — lossy but functionally acceptable for PT sessions where the raw data genuinely comes from structured intake forms.

**Status:** PT path only.

---

### `progress_agent`

**Receives:** All `Summary` rows with `agent_name="reporter"` for a patient.

**Improvement:** Exercise session summaries written by `exercise_reporter_agent` use `agent_name="reporter"`, so `progress_agent` now sees longitudinal summaries from both PT and exercise sessions in its query.

---

## Remaining structural issues

### 1. `pose_analysis_agent` still duplicates mobile work (for PT path)

The agent re-derives ROM from raw frames; the mobile app computes 12 features per rep. No fix applied — the PT frame path is the only consumer of `pose_analysis_agent`, and changing it would require restructuring the PT intake flow.

### 2. Agentverse path is architecturally orphaned

No documented external entry point routes exercise results into the uAgent pipeline. The HTTP pipeline is the active path in production. The Agentverse path is available for future external orchestration via Fetch.ai.

### 3. ChromaDB is ephemeral on Railway

No clinical PDFs have been ingested into ChromaDB. The RAG context in all agents will be empty (`"No relevant context found"`) until PDFs are added to `rag/loader.py`'s source directory and the service is restarted. This does not break the pipeline — agents degrade gracefully to LLM-only analysis.

---

## Railway services

| Service | Type | Internal hostname | Public URL |
|---------|------|-------------------|------------|
| `sentinel-backend` | FastAPI + uAgents | `sentinel-backend.railway.internal` | `https://sentinel-backend-production-e75a.up.railway.app` |
| `Postgres` | PostgreSQL 16 | `postgres.railway.internal:5432` | `shuttle.proxy.rlwy.net:41437` |

Services communicate over Railway's private network. `sentinel-backend` connects to Postgres via `DATABASE_URL=postgresql://postgres:...@postgres.railway.internal:5432/railway` (rewritten to `postgresql+asyncpg://` by the `fix_db_scheme` validator in `config.py`).

The `releaseCommand = "uv run alembic upgrade head"` in `railway.toml` runs Alembic migrations before each deploy is promoted to live traffic. Current schema includes migrations `0001` through `0005`, including linked sessions, uploaded exercise CSV artifacts, nullable `sessions.patient_id`, and patient metadata stored on `patients.metadata_json`.

---

## What still needs doing

| Priority | Change | Rationale |
|----------|--------|-----------|
| Medium | Ingest clinical PDFs into ChromaDB | RAG context currently always empty; agents degrade to LLM-only |
| Medium | Retire `pose_analysis_agent` or reduce to PT-frame fallback | Mobile computes richer analysis; PT path is the only consumer |
| Low | Document Agentverse path entry point | Currently unreachable from any external caller |
| Low | Add per-rep side-aware analysis to `exercise_reporter_agent` | Left/right error profiles differ per rep; currently averaged |
