# Sentinel Backend — Technical Reference

FastAPI + Fetch.ai uAgents backend for the Sentinel physiotherapy assistant.  
Stores PT session data, runs a multi-agent clinical pipeline, and receives processed squat analysis results from the mobile app.

---

## Directory layout

```
backend/
├── main.py                  FastAPI app + lifespan (RAG index init)
├── run_agent.py             Entry point — FastAPI thread + Fetch.ai Bureau
├── config.py                Pydantic settings (reads .env)
├── alembic.ini              Alembic config
│
├── agents/
│   ├── _client.py           Shared Gemini LLM client (OpenAI-compatible endpoint)
│   ├── messages.py          Typed uagents.Model message classes
│   ├── agentverse_agent.py  Orchestrator uAgent (mailbox, ctx.send dispatch)
│   ├── bureau.py            Assembles all uAgents into one Bureau
│   ├── orchestrator.py      HTTP-path pipeline (direct async function calls)
│   ├── intake.py            Normalise pain scores + extract target joints
│   ├── pose_analysis.py     Aggregate pose frames → ROM + flagged joints
│   ├── fall_risk.py         Fall risk score + reasoning
│   ├── reinjury_risk.py     Re-injury risk trend
│   ├── reporter.py          Session summary + recommendations
│   ├── progress.py          Longitudinal report (triggers at ≥3 sessions)
│   ├── exercise_reporter.py Direct clinical pipeline for mobile exercise sessions
│   └── hipaa.py             PHI redaction wrapper (Presidio + audit write)
│
├── db/
│   ├── models.py            SQLAlchemy ORM models
│   ├── session.py           Async engine + get_db dependency
│   └── migrations/
│       └── versions/
│           ├── 0001_initial.py
│           ├── 0002_exercise_sessions.py
│           ├── 0003_exercise_linked_session.py
│           ├── 0004_exercise_artifacts_and_nullable_session_patient.py
│           └── 0005_patient_metadata.py
│
├── routers/
│   ├── auth.py              JWT issue + require_jwt dependency
│   ├── patients.py          Patient metadata upsert + patient overview read model
│   ├── sessions.py          Session lifecycle + exercise result ingestion
│   ├── reports.py           Latest report + progress report per patient
│   └── exports.py           Dev-only: dump session artifacts to local disk
│
├── schemas/
│   ├── patient.py           Patient metadata + patient overview response models
│   ├── session.py           Pydantic models for the PT agent pipeline I/O
│   ├── report.py            SessionStart, FrameRequest, Token models
│   └── exercise.py          Squat session schema (matches mobile output exactly)
│
├── rag/
│   ├── loader.py            Ingest clinical guidelines PDFs into ChromaDB
│   └── retriever.py         Query ChromaDB (LlamaIndex + MiniLM embeddings)
│
└── utils/
    ├── audit.py             write_audit() — appends to audit_log table
    ├── frame_csv.py         parse_frame_features_csv() — CSV → PoseFrame rows
    └── phi_scanner.py       Presidio scan_and_redact() helper
```

---

## Data layer

### Models (`db/models.py`)

| Table | Purpose |
|-------|---------|
| `patients` | Patient identity (name + DOB stored encrypted) |
| `sessions` | PT session record — links patient, timestamps, pt_plan |
| `session_scores` | Numeric risk/ROM scores per PT session |
| `accumulated_scores` | Rolling averages per patient (fall + reinjury risk) |
| `pose_frames` | Raw per-frame pose data (`angles_json`) from live capture |
| `summaries` | Agent output text (one row per agent per session) |
| `audit_log` | Append-only HIPAA audit trail |
| `exercise_sessions` | Top-level squat (or other exercise) session, sent by mobile |
| `rep_analyses` | One row per rep — all 12 biomechanical features as typed columns |

`patients.metadata_json` stores the mobile intake profile
(`age`, `gender`, `heightCm`, `weightKg`, `bmi`, `demographicRiskScore`).
That makes the backend patient row the canonical metadata record instead of
leaving the intake profile only on the phone.

### Exercise session schema

The mobile app completes on-device pose analysis, requests a JWT from
`POST /auth/token`, then POSTs the full result to `POST /sessions/exercise-result`.
The backend stores the upload in three places:

**`exercise_sessions`** holds the session-level envelope: `mobile_session_id`
(the ISO timestamp from the phone, `unique`), `exercise`, `num_reps`, timing ms
fields, `summary_json` (aggregate stats: avgDepth, avgFppa, consistency,
overallRating), plus the uploaded CSV artifacts `reps_csv` and
`frame_features_csv`.

**`rep_analyses`** holds one row per rep with flat, typed columns for every feature and error flag — making them directly queryable for analytics without JSON extraction:

```
knee_flexion_deg, rom_ratio, fppa_peak, fppa_at_depth,
trunk_lean_peak, trunk_flex_peak, pelvic_drop_peak, pelvic_shift_peak,
hip_adduction_peak, knee_offset_peak, sway_norm, smoothness

knee_valgus, trunk_lean, trunk_flex, pelvic_drop,
pelvic_shift, hip_adduction, knee_over_foot, balance

total_errors, classification, confidence
```

**`pose_frames`** receives parsed rows from `frameFeaturesCsv` against the
linked companion `sessions` row. That keeps the uploaded frame-feature trace in
the database for fallback analysis and debugging without relying on the
dev-only exports endpoint.

### Migrations

- **Dev**: `init_db()` calls `create_all` on startup (SQLite, no Alembic needed).
- **Prod**: Alembic is authoritative. Run `alembic upgrade head` before starting the server. On Railway this is handled by the `releaseCommand` in `railway.toml` — it runs once per deploy before traffic is cut over.

Migration files live in `db/migrations/versions/`. Add new ones with `alembic revision --autogenerate -m "<description>"`, then review and edit the generated file before committing.

---

## API surface

All endpoints require a JWT `Authorization: Bearer <token>` header **except** in `DEV_MODE` (where `require_jwt` returns a synthetic admin user without checking the header).

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/token` | None | Issue a JWT for `{user_id, role}` |

Token lifetime: 24 hours. Algorithm: HS256. Secret: `JWT_SECRET` env var.

### Sessions (PT pipeline)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/sessions/start` | JWT | Create a new PT session record, return `session_id` |
| POST | `/sessions/{id}/frame` | JWT | Append a raw pose frame (`angles_json`, `timestamp`) |
| POST | `/sessions/{id}/end` | JWT | Close session, run full agent pipeline, return reporter summary |

### Sessions (exercise analysis)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/sessions/exercise-result` | JWT | Receive a complete processed session from the mobile app (squat etc.), persist the schema and uploaded CSV artifacts to `exercise_sessions`, rep rows to `rep_analyses`, and parsed frame-feature rows to `pose_frames` via a linked companion session. Returns 409 if the same `sessionId` was already stored. |

### Patients

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| PUT | `/patients/{patient_id}` | JWT | Upsert the patient metadata record from the mobile intake flow |
| GET | `/patients/{patient_id}` | JWT | Fetch the patient metadata record |
| GET | `/patients/{patient_id}/overview` | JWT | Fetch patient metadata, accumulated scores, session count, and the recent session timeline |

### Reports

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/reports/{patient_id}/latest` | JWT | Latest reporter-agent summary for a patient |
| GET | `/reports/{patient_id}/progress` | JWT | Trigger (or re-run) the progress agent for a patient |

### Exports (dev only)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/exports/session` | None (DEV_MODE) | Dev-only artifact dump: write session JSON + CSVs to `<repo>/exports/<timestamp>_<session_id>/` on the local machine. Not used by the mobile app's production upload flow. Returns 403 in production. |

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Returns `{"status": "ok"}` — used by Railway healthcheck |

---

## Agent pipeline

Three execution paths exist. The PT HTTP path powers clinician-style
`/sessions/{id}/end`, the exercise HTTP path powers mobile uploads to
`/sessions/exercise-result`, and the Agentverse path enables external
orchestration via Fetch.ai.

### HTTP path (`orchestrator.py`)

Called by `POST /sessions/{id}/end`. Runs agents as direct async function calls inside the FastAPI request:

```
run_intake()
    ↓
run_pose_analysis()
    ↓
run_fall_risk()   ← sequential (same db session — concurrent gather
run_reinjury_risk()  would cause illegal concurrent commits)
    ↓
run_reporter()
    ↓
run_progress()   ← only if patient has ≥ 3 sessions
```

Each step is wrapped in its own `try/except`. If a step fails, `failed_agents` is populated, the current results are committed, and the pipeline short-circuits — no downstream agent runs. This ensures partial results are never lost.

A single `db.commit()` at the end commits everything accumulated across all agents.

### Exercise HTTP path (`/sessions/exercise-result` → `run_exercise_pipeline`)

The mobile app uploads the already-processed exercise session schema and CSV
artifacts. The backend then:

1. ensures the referenced patient exists
2. creates a linked companion `sessions` row
3. stores the uploaded envelope in `exercise_sessions`
4. stores one row per rep in `rep_analyses`
5. parses `frameFeaturesCsv` into `pose_frames`
6. runs `exercise_reporter_agent` in the background
7. runs `progress_agent` if the patient has 3+ linked sessions

### Agentverse path (`agentverse_agent.py` + `bureau.py`)

The `physio-orchestrator` uAgent holds a Fetch.ai mailbox key and is registered on Agentverse. External systems send it a `SessionRequestMessage`. It dispatches via `ctx.send()` through the same logical pipeline, communicating with sub-agents via typed `uagents.Model` messages defined in `agents/messages.py`.

`run_agent.py` starts both:
- FastAPI on port 8000 (daemon thread)
- The Fetch.ai `Bureau` (blocking main thread) which runs all 7 uAgents together

### HIPAA middleware

Every agent output that will be written to the database passes through `hipaa_wrap()` in `agents/hipaa.py`:

1. `scan_and_redact(content)` — calls Microsoft Presidio to detect PHI entities (names, DOBs, NHS numbers, etc.) and replace them with `<ENTITY_TYPE>` placeholders.
2. `write_audit(...)` — appends an entry to `audit_log` with actor, action, patient_id, data_type, and UTC timestamp. The caller owns the transaction; no commit happens inside `write_audit`.

---

## RAG pipeline

Clinical guidelines (PDFs) are embedded at startup via `rag/loader.py`:

- Embedding model: `sentence-transformers/all-MiniLM-L6-v2` (runs locally, no API key needed)
- Vector store: ChromaDB persistent client at `CHROMA_PERSIST_DIR`
- Index: LlamaIndex `VectorStoreIndex` wrapping the Chroma collection `clinical_guidelines`

At query time, `retrieve_clinical_context(query, top_k=5)` retrieves the top-5 most relevant chunks. Agents (primarily `reporter` and `fall_risk`) prepend this context to their LLM prompts.

The index is built once on first load and cached in-process. Re-ingest by deleting the `chroma_db/` directory and restarting.

---

## Auth detail

`require_jwt` is a FastAPI dependency injected into every protected route.

- **DEV_MODE = True** (default in `.env`): the dependency short-circuits and returns `{"user_id": "dev", "role": "admin"}` without checking any header. This means the mobile app does not need to manage tokens during local development.
- **DEV_MODE = False**: a valid `Authorization: Bearer <token>` header is required. The token is verified with `JWT_SECRET` and the HS256 algorithm. A 401 is raised on missing or invalid tokens. The mobile app now requests this token from `POST /auth/token` before uploading to `POST /sessions/exercise-result`.

The `/exports/session` endpoint also uses `DEV_MODE` as its gate — it returns 403 in production regardless of auth headers, and is only intended for local artifact dumping.

---

## Environment variables

| Variable | Default | Required in prod | Description |
|----------|---------|-----------------|-------------|
| `DATABASE_URL` | `sqlite+aiosqlite:///./sentinel_dev.db` | Yes | PostgreSQL async URL for production — `postgresql+asyncpg://user:pass@host:5432/db` |
| `OPENAI_API_KEY` | `""` | Yes | Used by general agents: intake, fall_risk, reinjury_risk, reporter, progress (model: `gpt-4o`) |
| `GEMINI_API_KEY` | `""` | Yes | Used by `exercise_reporter` for clinical biomechanics analysis (model: `gemini-2.0-flash`). Get one at [aistudio.google.com](https://aistudio.google.com). |
| `JWT_SECRET` | `dev-secret-change-in-prod` | Yes | Signing secret for HS256 JWT tokens |
| `CHROMA_PERSIST_DIR` | `./chroma_db` | Yes | Filesystem path for ChromaDB persistence |
| `AGENTVERSE_MAILBOX_KEY` | `""` | If using Agentverse | Fetch.ai mailbox key — get one at agentverse.ai |
| `DEV_MODE` | `True` | Must be `False` | Disables JWT enforcement and the exports endpoint |

---

## Railway deployment

### Overview

Railway builds from `backend/Dockerfile`. The `releaseCommand` in `railway.toml` runs Alembic migrations before each new deployment is promoted to live traffic. The start command then launches FastAPI + the Fetch.ai Bureau.

### Step-by-step

1. **Add a PostgreSQL plugin** to your Railway project. Railway injects `DATABASE_URL` automatically — but it uses the `postgres://` scheme. You must override it as a Railway variable with the `postgresql+asyncpg://` prefix (SQLAlchemy async driver):

   ```
   DATABASE_URL=postgresql+asyncpg://<user>:<pass>@<host>:<port>/<db>
   ```

2. **Set all required environment variables** in Railway → Project → Variables:

   ```
   DATABASE_URL=postgresql+asyncpg://...
   OPENAI_API_KEY=sk-...
   GEMINI_API_KEY=AIza...
   JWT_SECRET=<random 64-char string>
   CHROMA_PERSIST_DIR=/app/chroma_db
   AGENTVERSE_MAILBOX_KEY=<key from agentverse.ai>   # optional
   DEV_MODE=False
   ```

3. **Deploy**: push to your connected branch (or run `railway up` from the repo root). Railway will:
   - Build the Docker image
   - Run `alembic upgrade head` (release command — applies any pending migrations)
   - Start the server with `python run_agent.py`

4. **Health check**: Railway probes `GET /health` before routing traffic to the new instance. The endpoint returns `{"status": "ok"}`.

### ChromaDB persistence

ChromaDB writes to the local filesystem at `CHROMA_PERSIST_DIR`. On Railway this directory lives inside the container and is **ephemeral** — it is wiped on each new deployment. For a durable vector store in production you have two options:

- Mount a Railway **volume** at `/app/chroma_db` (persistent across deploys).
- Swap ChromaDB for a hosted vector database (Pinecone, Qdrant Cloud) and update `rag/loader.py` and `rag/retriever.py` accordingly.

### Fetch.ai Bureau on Railway

`run_agent.py` starts the Bureau in the main thread (blocking) and FastAPI in a daemon thread. Railway exposes port 8000 and routes HTTP traffic to FastAPI normally. The Bureau's internal agent-to-agent communication is in-process and does not need an external port. Only the orchestrator uAgent needs outbound HTTPS access to Agentverse (port 443), which Railway allows by default.

If `AGENTVERSE_MAILBOX_KEY` is empty, the orchestrator uAgent still starts but will not receive external Agentverse messages — the HTTP pipeline path continues to work normally.

---

## Local development

```bash
cd backend
cp .env.example .env          # fill in OPENAI_API_KEY at minimum
uv sync                        # install all dependencies (including dev)
alembic upgrade head           # create SQLite tables (or skip — init_db() does it on startup)
python run_agent.py
```

API: `http://localhost:8000`  
Swagger UI: `http://localhost:8000/docs`

SQLite database file: `sentinel_dev.db` (created automatically).  
ChromaDB: `./chroma_db/` (created on first ingest).

To ingest clinical guidelines into ChromaDB, drop PDFs into the directory configured in `rag/loader.py` and restart — `load_clinical_guidelines()` runs in the FastAPI lifespan hook.
