# Agent Architecture

Date: 2026-04-26  
Status: current code path after credibility fixes

## Purpose

This backend has two clinical-output pipelines:

1. PT session pipeline triggered by `POST /sessions/{session_id}/end`
2. Exercise pipeline triggered by `POST /sessions/exercise-result`

Both pipelines feed the same shared storage so the mobile app and the clinician dashboard can render:

- session summaries
- session scores
- structured report artifacts
- longitudinal progress reports

The main dashboard consumer today is `D:\OnTractSite`, which calls only:

- `GET /patients/{patient_id}/overview`
- `GET /reports/{patient_id}/latest`
- `GET /reports/{patient_id}/progress`

If an agent writes useful output that does not reach one of those routes, it is effectively invisible to the site.

## End-To-End Diagram

```mermaid
flowchart TD
    subgraph Mobile["Mobile app"]
        A["POST /sessions/{id}/end"]
        B["POST /sessions/exercise-result"]
    end

    subgraph PT["PT session pipeline"]
        A --> I["intake_agent"]
        I --> P["pose_analysis_agent"]
        P --> F["fall_risk_agent"]
        F --> R["reinjury_risk_agent"]
        R --> REP["reporter_agent"]
        REP --> PROG["progress_agent (if patient has 3+ sessions)"]
    end

    subgraph EX["Exercise pipeline"]
        B --> ER["exercise_reporter_agent"]
        ER --> PROG
    end

    subgraph DB["Shared persistence"]
        S["summaries"]
        SS["session_scores"]
        AA["agent_artifacts"]
        AC["accumulated_scores"]
    end

    I --> AA
    P --> AA
    F --> SS
    F --> AA
    R --> SS
    R --> AA
    REP --> S
    REP --> SS
    REP --> AA
    ER --> S
    ER --> SS
    ER --> AA
    PROG --> S
    PROG --> AC
    PROG --> AA

    subgraph Dashboard["Dashboard / site routes"]
        O["GET /patients/{id}/overview"]
        L["GET /reports/{id}/latest"]
        G["GET /reports/{id}/progress"]
    end

    DB --> O
    DB --> L
    DB --> G
```

## Route Contract

### `GET /patients/{patient_id}/overview`

Primary use:

- patient header
- score rings fallback values
- session history list

Current sources:

- `patients`
- `sessions`
- `exercise_sessions`
- `session_scores`
- `summaries`
- `accumulated_scores`

Important note:

- this route already returns grouped exercise visit information through `recent_sessions[].exercises` and `recent_sessions[].num_exercises`
- the current site types are stale and still treat exercise visits like a single `exercise` string

### `GET /reports/{patient_id}/latest`

Primary use:

- latest clinical summary
- session highlights
- recommendations
- evidence map

Current source of truth:

- latest `agent_artifacts` row where `agent_name="reporter_agent"` and `artifact_kind="reporter_output"`

Fallback:

- latest `Summary(agent_name="reporter")`

This matters because the old route returned only the summary text and threw away the structured fields the site is already built to render.

### `GET /reports/{patient_id}/progress`

Primary use:

- overall longitudinal trend
- milestones
- next goals
- longitudinal narrative

Current writes:

- `Summary(agent_name="progress", session_id=None)`
- `AccumulatedScore`
- `AgentArtifact(agent_name="progress_agent", session_id=None)`

The route now commits after `run_progress()` so those writes persist when the endpoint is called directly.

## PT Session Pipeline

### 1. `intake_agent`

File: `backend/agents/intake.py`

Inputs:

- intake payload from the mobile app
- `Patient.metadata_json`

Grounded behavior:

- reads stored clinical metadata deterministically

LLM behavior:

- normalizes pain scores
- extracts target joints
- extracts session goals

Writes:

- `AgentArtifact(agent_name="intake_agent")`

Risk level:

- medium hallucination risk because structured clinical fields are extracted by model output

### 2. `pose_analysis_agent`

File: `backend/agents/pose_analysis.py`

Inputs:

- `PoseFrame` rows for the session

Behavior:

- fully deterministic
- computes per-joint ROM statistics, coverage, and flags

Writes:

- `AgentArtifact(agent_name="pose_analysis_agent")`

Risk level:

- low hallucination risk
- correctness depends on upstream pose capture quality and biomechanical math

### 3. `fall_risk_agent`

File: `backend/agents/fall_risk.py`

Inputs:

- `IntakeOutput`
- `PoseAnalysisOutput`
- optional RAG context

Behavior:

- uses RAG when available
- asks the model for a numeric fall-risk score and rationale

Writes:

- `SessionScore.fall_risk_score`
- `AgentArtifact(agent_name="fall_risk_agent")`

Risk level:

- high hallucination risk because a model assigns a numeric clinical score

### 4. `reinjury_risk_agent`

File: `backend/agents/reinjury_risk.py`

Inputs:

- prior pose artifacts
- recent exercise rep data
- session-score history

Behavior:

- deterministic trend assembly
- model-generated reinjury score and trend explanation

Writes:

- `SessionScore.reinjury_risk_score`
- `AgentArtifact(agent_name="reinjury_risk_agent")`

Risk level:

- high hallucination risk because a model assigns a numeric clinical score

### 5. `reporter_agent`

File: `backend/agents/reporter.py`

Inputs:

- intake output
- pose analysis output
- fall risk output
- reinjury risk output
- last three reporter summaries

Behavior:

- model writes:
  - `summary`
  - `session_highlights`
  - `recommendations`
  - `evidence_map`

Writes:

- `Summary(agent_name="reporter")`
- `SessionScore.pain_score`
- `SessionScore.rom_score`
- `AgentArtifact(agent_name="reporter_agent", artifact_kind="reporter_output")`

Artifact payload now includes:

- summary
- session highlights
- recommendations
- evidence map
- scores
- `reportability="reportable"`

Risk level:

- medium to high hallucination risk in wording
- lower than before for transport, because the structured output now reaches `/reports/latest` intact

### 6. `progress_agent`

Files:

- `backend/agents/progress.py`
- `backend/agents/progress_salience.py`

Behavior:

1. build patient timeline from stored scores, summaries, and artifacts
2. compute salience deterministically
3. send only salient evidence to the model
4. persist longitudinal summary and provenance

Writes:

- `Summary(agent_name="progress", session_id=None)`
- `AccumulatedScore`
- `AgentArtifact(agent_name="progress_agent", session_id=None)`

Risk level:

- medium hallucination risk in narrative language
- salience selection itself is deterministic and grounded

## Exercise Pipeline

### `exercise_reporter_agent`

File: `backend/agents/exercise_reporter.py`

Inputs:

- native exercise payload from the mobile app
- rep features
- rep-level confidence
- rep timing

Behavior:

1. filter reps on quality thresholds
2. compute deterministic session statistics
3. if no reps pass quality:
   - do not call the model
   - write an insufficient-quality summary
   - do not write `SessionScore`
4. if reps pass quality:
   - query RAG
   - ask the model for summary, highlights, recommendations

Writes:

- `Summary(agent_name="reporter")`
- `SessionScore` only when the session is reportable
- `AgentArtifact(agent_name="reporter_agent", artifact_kind="reporter_output")`

Artifact payload includes:

- summary
- session highlights
- recommendations
- evidence map
- good-rep and filtered-rep counts
- scores when reportable
- `reportability`

Why this matters:

- exercise sessions now participate in the same latest-report contract as PT sessions
- dashboards can distinguish grounded reports from insufficient-quality captures

## Shared Persistence Model

### `summaries`

Human-readable narrative output.

Used by:

- session history
- latest summary fallback
- progress context

Weakness:

- text alone does not tell the UI whether a report is grounded, insufficient, or low-confidence

### `session_scores`

Numeric rollup fields:

- `fall_risk_score`
- `reinjury_risk_score`
- `pain_score`
- `rom_score`

Used by:

- score rings
- longitudinal averages
- progress trend calculations

Weakness:

- PT risk scores are still model-generated, not deterministic clinical calculations

### `agent_artifacts`

Structured provenance and agent output.

This is the most important table for trustworthy rendering because it can carry:

- structured report fields
- evidence maps
- data coverage notes
- reportability state
- provenance links

If the UI wants grounded presentation, it should prefer artifact-backed rendering over summary-only rendering.

### `accumulated_scores`

Weighted averages of recent sessions.

Used by:

- overview score rings

Weakness:

- averages can look authoritative even when sourced from model-generated scores or mixed-quality sessions

## What Is Grounded vs Inferred

### Mostly grounded

- raw exercise upload storage
- raw pose frame storage
- pose-analysis statistics
- deterministic exercise rep aggregation
- progress salience selection

### Model-generated or inference-heavy

- intake normalization and goal extraction
- fall-risk numeric score
- reinjury-risk numeric score
- session report prose
- longitudinal progress prose

### Newly added guardrails

- exercise reports skip the model entirely when no reps pass quality
- `/reports/latest` now returns structured artifact output instead of summary text alone
- `/reports/progress` now prefers stored `progress_agent` artifacts instead of regenerating on every dashboard refresh
- progress writes are committed from the route path

## Current Truthfulness Gaps

These are still open and materially affect credibility:

1. `src/engine/exercise/frameFeatures.ts` still contains incorrect biomechanics calculations.
   - This contaminates exercise features before any backend agent sees them.

2. PT fall-risk and reinjury-risk scores are still model-generated numbers.
   - The UI should not present them as if they were purely measured quantities.

3. Score provenance is still only partially explicit.
   - The site now shows reportability, coverage notes, grouped exercise visits, and progress citations.
   - It still does not label each score ring with exact provenance such as `model-estimated`, `deterministic`, or `rolling average`.

4. The dashboard still has to infer some state across multiple routes.
   - Example: latest-session quality comes from `/reports/latest`, while score history comes from `/patients/{id}/overview`.
   - A unified dashboard-status payload would reduce ambiguity and UI-side guesswork.

## Dashboard Recommendations

If the goal is to look credible rather than merely polished, the site should make these changes next:

1. Add per-score provenance labels.
   - Example: `model-estimated risk`, `deterministic ROM`, `rolling average`, `capture insufficient`.

2. Add explicit latest-report status fields to `/patients/{patient_id}/overview`.
   - This removes the need to combine overview and latest-report routes just to explain score quality.

3. Surface `good_reps` and `filtered_reps` on the dashboard.
   - Those numbers are already written on exercise reporter artifacts and are high-value trust signals.

4. If a process diagram returns, back it with real artifact timestamps/status.
   - Decorative agent diagrams should not imply actual orchestrator topology.

5. Add artifact schema/version metadata to the API.
   - This makes frontend rendering safer as report structures evolve.

## Agent Recommendations

Highest-value backend changes still pending:

1. Fix biomechanics in `src/engine/exercise/frameFeatures.ts`.
2. Add reportability and data-quality fields to overview responses so the site does not have to infer them.
3. Reduce or constrain model-generated PT numeric scoring.
4. Persist a schema version on artifact payloads.
5. Surface low-confidence or insufficient-data states all the way to the UI instead of silently averaging them into score rings.
