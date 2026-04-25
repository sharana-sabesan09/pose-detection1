# Agent Backend — Build Jobs

All code lives in `/backend`. Python 3.11+. Use `uv` for dependency management.

---

## Job 0 — Project Scaffold

**Create the following directory structure:**

```
backend/
  main.py               # FastAPI entry point
  config.py             # env vars (DATABASE_URL, ANTHROPIC_API_KEY, etc.)
  db/
    models.py           # SQLAlchemy models
    session.py          # async engine + session factory
    migrations/         # Alembic migrations
  agents/
    orchestrator.py
    intake.py
    pose_analysis.py
    fall_risk.py
    reinjury_risk.py
    reporter.py
    progress.py
    hipaa.py            # middleware agent
  rag/
    loader.py           # chunk + embed clinical docs at startup
    retriever.py        # query ChromaDB
  routers/
    sessions.py         # REST endpoints the RN app hits
    reports.py
  schemas/
    session.py          # Pydantic models
    report.py
  utils/
    phi_scanner.py      # Presidio wrapper
    audit.py            # write to audit_log table
```

**Dependencies to install:**
```
fastapi uvicorn sqlalchemy asyncpg alembic
uagents chromadb llama-index
presidio-analyzer presidio-anonymizer
anthropic python-jose[cryptography] passlib
python-dotenv
```

---

## Job 1 — Database Models (`db/models.py`)

Create SQLAlchemy async models for:

- `Patient` — id (uuid), name_encrypted (text), dob_encrypted (text), created_at
- `Session` — id (uuid), patient_id (fk), pt_plan (text), started_at, ended_at
- `SessionScore` — id, session_id (fk), fall_risk_score (float), reinjury_risk_score (float), pain_score (float), rom_score (float), created_at
- `AccumulatedScore` — id, patient_id (fk), fall_risk_avg (float), reinjury_risk_avg (float), updated_at
- `PoseFrame` — id, session_id (fk), timestamp (float), angles_json (jsonb)
- `Summary` — id, session_id (fk), agent_name (text), content (text), created_at
- `AuditLog` — id, actor (text), action (text), patient_id (uuid nullable), data_type (text), timestamp

Set up Alembic. Generate the initial migration. All uuid primary keys.

---

## Job 2 — Config + DB Session (`config.py`, `db/session.py`)

`config.py`: load from `.env`:
- `DATABASE_URL`
- `ANTHROPIC_API_KEY`
- `JWT_SECRET`
- `CHROMA_PERSIST_DIR`

`db/session.py`: async SQLAlchemy engine + `get_db` dependency for FastAPI.

---

## Job 3 — HIPAA Middleware (`agents/hipaa.py`, `utils/phi_scanner.py`, `utils/audit.py`)

`phi_scanner.py`:
- Wrap Microsoft Presidio `AnalyzerEngine` + `AnonymizerEngine`
- `scan_and_redact(text: str) -> tuple[str, list[str]]` — returns redacted text and list of entity types found
- Entities to detect: PERSON, EMAIL_ADDRESS, PHONE_NUMBER, DATE_TIME, LOCATION, US_SSN, MEDICAL_LICENSE

`audit.py`:
- `write_audit(actor: str, action: str, patient_id: str | None, data_type: str, db)` — async write to AuditLog table

`hipaa.py`:
- `async def hipaa_wrap(content: str, actor: str, patient_id: str, data_type: str, db) -> str`
  - Runs `scan_and_redact` on content
  - Calls `write_audit`
  - Returns redacted content
  - If PHI found, also logs a warning with entity types (not the actual PHI)

This function must be called by every agent before writing any output to DB or passing to another agent.

---

## Job 4 — RAG Pipeline (`rag/loader.py`, `rag/retriever.py`)

`loader.py`:
- At startup, check if ChromaDB collection `clinical_guidelines` exists and is non-empty
- If not, chunk and embed these hardcoded sources (use placeholder text if PDFs not present, but structure for real PDFs):
  - CDC STEADI Fall Prevention toolkit
  - Berg Balance Scale scoring guide
  - Generic ROM/physical therapy reinjury risk guidelines
- Use `llama-index` with `chromadb` vector store, `text-embedding-3-small` or sentence-transformers for embeddings
- Chunk size: 512 tokens, overlap: 64

`retriever.py`:
- `async def retrieve_clinical_context(query: str, top_k: int = 5) -> str`
- Queries ChromaDB collection, returns concatenated top-k chunks as a single string

---

## Job 5 — Intake Agent (`agents/intake.py`)

Input schema:
```python
class IntakeInput(BaseModel):
    session_id: str
    patient_id: str
    pt_plan: str          # free text from PT
    pain_scores: dict     # e.g. {"lower_back": 7, "left_knee": 4}
    user_input: str       # any additional patient-reported info
```

Logic:
- Call Claude (`claude-sonnet-4-20250514`) with a structured prompt to parse and normalize the intake data
- Output: `IntakeOutput` with fields `normalized_pain_scores: dict`, `target_joints: list[str]`, `session_goals: list[str]`
- Pass output through `hipaa_wrap` before returning
- Write audit log: actor=`intake_agent`

---

## Job 6 — Pose Analysis Agent (`agents/pose_analysis.py`)

Input: `session_id: str`

Logic:
- Query `PoseFrame` table for all frames in session
- Compute per-joint angle statistics: mean, min, max, std for each joint key
- Compute ROM score: average of (max_angle - min_angle) across target joints, normalized 0-100
- Return `PoseAnalysisOutput`: `rom_score: float`, `joint_stats: dict`, `flagged_joints: list[str]` (joints where ROM < 40% of expected range -- hardcode expected ranges per joint)
- Write audit log: actor=`pose_analysis_agent`
- No Claude call needed here, pure computation.

---

## Job 7 — Fall Risk Agent (`agents/fall_risk.py`)

Input: `IntakeOutput + PoseAnalysisOutput + patient_id: str`

Logic:
- Call `retrieve_clinical_context` with query built from flagged joints + pain scores
- Call Claude with:
  - System: "You are a clinical fall risk assessor. Output only valid JSON."
  - User: structured prompt with intake data, pose stats, and retrieved clinical context
- Parse response into `FallRiskOutput`: `score: float (0-100)`, `risk_level: str (low/medium/high)`, `reasoning: str`, `contributing_factors: list[str]`
- Pass `reasoning` through `hipaa_wrap`
- Write `SessionScore.fall_risk_score` to DB
- Write audit log: actor=`fall_risk_agent`

---

## Job 8 — Reinjury Risk Agent (`agents/reinjury_risk.py`)

Input: `patient_id: str`, `session_id: str`, `PoseAnalysisOutput`

Logic:
- Query last 5 `SessionScore` rows for this patient ordered by created_at desc
- Compute delta trends: is fall_risk_score trending up? Is rom_score trending down?
- Call Claude with trend data to produce `ReinjuryRiskOutput`: `score: float (0-100)`, `trend: str (improving/stable/worsening)`, `reasoning: str`
- Pass `reasoning` through `hipaa_wrap`
- Write `SessionScore.reinjury_risk_score` to DB
- Write audit log: actor=`reinjury_risk_agent`

---

## Job 9 — Reporter Agent (`agents/reporter.py`)

Input: `session_id: str`, `patient_id: str`, `IntakeOutput`, `PoseAnalysisOutput`, `FallRiskOutput`, `ReinjuryRiskOutput`

Logic:
- Query last 3 `Summary` rows for this patient where `agent_name = 'reporter'` ordered by created_at desc
- Call Claude with all inputs + past summaries:
  - System: "You are a physical therapy session reporter. Write a structured clinical summary. Do not include patient names or identifiers."
  - User: all structured data + "Previous summaries for context: {past_summaries}"
- Output: `ReporterOutput`: `summary: str`, `session_highlights: list[str]`, `recommendations: list[str]`
- Pass entire output through `hipaa_wrap`
- Write to `Summary` table: `agent_name='reporter'`, `session_id`, `content=summary`
- Write `SessionScore.pain_score` and `SessionScore.rom_score` final values
- Write audit log: actor=`reporter_agent`

---

## Job 10 — Progress Agent (`agents/progress.py`)

Input: `patient_id: str`

Logic:
- Query ALL `Summary` rows for patient where `agent_name = 'reporter'` ordered by created_at asc
- Query `AccumulatedScore` for patient
- Call Claude with all summaries + accumulated scores:
  - System: "You are a longitudinal physical therapy progress analyst."
  - User: all summaries + score trends
- Output: `ProgressOutput`: `longitudinal_report: str`, `overall_trend: str`, `milestones_reached: list[str]`, `next_goals: list[str]`
- Pass output through `hipaa_wrap`
- Write to `Summary` table: `agent_name='progress'`, `session_id=None`, `content=longitudinal_report`
- Recompute `AccumulatedScore` for patient: weighted average of last 10 sessions (recency weight = 1/rank)
- Write audit log: actor=`progress_agent`

---

## Job 11 — Orchestrator (`agents/orchestrator.py`)

`async def run_session_pipeline(session_id: str, patient_id: str, intake_data: IntakeInput, db) -> dict`

Sequential execution:
1. `IntakeOutput` = await intake agent
2. `PoseAnalysisOutput` = await pose analysis agent
3. `FallRiskOutput`, `ReinjuryRiskOutput` = await asyncio.gather(fall risk, reinjury risk) -- these can run in parallel
4. `ReporterOutput` = await reporter agent
5. `ProgressOutput` = await progress agent (optional, only if patient has 3+ sessions)
6. Return all outputs as a combined dict

Wrap the entire pipeline in try/except. On any agent failure, log the error, write an audit entry with action=`pipeline_error`, and return partial results with a `failed_agents` list.

---

## Job 12 — uAgents Registration (`agents/agentverse_agent.py`)

Create a uAgents `Agent` named `"physio-orchestrator"` with a mailbox key (load from env `AGENTVERSE_MAILBOX_KEY`).

Define a message handler that:
- Accepts `SessionQueryMessage`: `{ session_id: str, patient_id: str, query_type: "session" | "progress" }`
- Calls the orchestrator pipeline
- Returns `SessionResponseMessage`: `{ summary: str, scores: dict, status: str }`

Register the agent on startup. The agent should run in a background thread alongside FastAPI using `asyncio`.

Add startup script `run_agent.py` that starts both FastAPI (via uvicorn) and the uAgent together.

---

## Job 13 — FastAPI Routers (`routers/sessions.py`, `routers/reports.py`)

`POST /sessions/start` — create a `Session` row, return `session_id`

`POST /sessions/{session_id}/frame` — accept `{ angles_json: dict, timestamp: float }`, write to `PoseFrame`

`POST /sessions/{session_id}/end` — accept `IntakeInput`, trigger full orchestrator pipeline, return `ReporterOutput`

`GET /reports/{patient_id}/latest` — return latest Reporter summary

`GET /reports/{patient_id}/progress` — trigger Progress Agent, return `ProgressOutput`

All routes require JWT auth. Add a `POST /auth/token` route that accepts `{ user_id, role }` and returns a signed JWT. (No real auth system needed for hackathon -- just verify the token is valid and attach user context.)

---

## Job 14 — Railway Deployment Config

Create:

`Dockerfile`:
- Python 3.11 slim base
- Install deps
- Run `run_agent.py`

`railway.toml`:
```toml
[build]
builder = "dockerfile"

[deploy]
startCommand = "python run_agent.py"
healthcheckPath = "/health"
```

`GET /health` endpoint in `main.py` returning `{"status": "ok"}`.

`.env.example` with all required env vars listed but no values.

---

## Acceptance Criteria (end of all jobs)

- `POST /sessions/{id}/end` triggers full pipeline and returns a Reporter summary with no raw PHI in any field
- Every agent invocation writes an entry to `audit_log`
- Fall Risk and Reinjury Risk scores are written to `session_scores` per session
- `accumulated_scores` is updated on session end
- uAgent is reachable via Agentverse mailbox and returns a summary when sent a valid `SessionQueryMessage`
- All Claude calls use model `claude-sonnet-4-20250514`
- Service starts cleanly from Docker with only env vars configured
