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
│   └── hipaa.py             PHI redaction wrapper (Presidio + audit write)
│
├── db/
│   ├── models.py            SQLAlchemy ORM models
│   ├── session.py           Async engine + get_db dependency
│   └── migrations/
│       └── versions/
│           ├── 0001_initial.py
│           └── 0002_exercise_sessions.py
│
├── routers/
│   ├── auth.py              JWT issue + require_jwt dependency
│   ├── sessions.py          Session lifecycle + exercise result ingestion
│   ├── reports.py           Latest report + progress report per patient
│   └── exports.py           Dev-only: dump session artifacts to local disk
│
├── schemas/
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

### Exercise session schema

The mobile app completes on-device pose analysis and POSTs the full result to `POST /sessions/exercise-result`. The backend stores it in two tables:

**`exercise_sessions`** holds the session-level envelope: `mobile_session_id` (the ISO timestamp from the phone, `unique`), `exercise`, `num_reps`, timing ms fields, and `summary_json` (aggregate stats: avgDepth, avgFppa, consistency, overallRating).

**`rep_analyses`** holds one row per rep with flat, typed columns for every feature and error flag — making them directly queryable for analytics without JSON extraction:

```
knee_flexion_deg, rom_ratio, fppa_peak, fppa_at_depth,
trunk_lean_peak, trunk_flex_peak, pelvic_drop_peak, pelvic_shift_peak,
hip_adduction_peak, knee_offset_peak, sway_norm, smoothness

knee_valgus, trunk_lean, trunk_flex, pelvic_drop,
pelvic_shift, hip_adduction, knee_over_foot, balance

total_errors, classification, confidence
```

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
| POST | `/sessions/exercise-result` | JWT | Receive a complete processed session from the mobile app (squat etc.), persist to `exercise_sessions` + `rep_analyses`. Returns 409 if the same `sessionId` was already stored. |

### Reports

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/reports/{patient_id}/latest` | JWT | Latest reporter-agent summary for a patient |
| GET | `/reports/{patient_id}/progress` | JWT | Trigger (or re-run) the progress agent for a patient |

### Exports (dev only)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/exports/session` | None (DEV_MODE) | Write session JSON + CSVs to `<repo>/exports/<timestamp>_<session_id>/` on the local machine. Returns 403 in production. |

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Returns `{"status": "ok"}` — used by Railway healthcheck |

---

## Agent pipeline (PT path)

Two execution paths exist. The HTTP path is the only one currently triggered by the mobile app. The Agentverse path enables external orchestration via Fetch.ai.

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

At query time, `retrieve_clinical_context(query, top_k=5)` retrieves the top-5 most relevant chunks. Agents (primarily `reporter` and `fall_risk`) prepend this context to their OpenAI prompts.

The index is built once on first load and cached in-process. Re-ingest by deleting the `chroma_db/` directory and restarting.

---

## Auth detail

`require_jwt` is a FastAPI dependency injected into every protected route.

- **DEV_MODE = True** (default in `.env`): the dependency short-circuits and returns `{"user_id": "dev", "role": "admin"}` without checking any header. This means the mobile app does not need to manage tokens during local development.
- **DEV_MODE = False**: a valid `Authorization: Bearer <token>` header is required. The token is verified with `JWT_SECRET` and the HS256 algorithm. A 401 is raised on missing or invalid tokens.

The `/exports/session` endpoint also uses `DEV_MODE` as its gate — it returns 403 in production regardless of auth headers.

---

## Environment variables

| Variable | Default | Required in prod | Description |
|----------|---------|-----------------|-------------|
| `DATABASE_URL` | `sqlite+aiosqlite:///./sentinel_dev.db` | Yes | PostgreSQL async URL for production — `postgresql+asyncpg://user:pass@host:5432/db` |
| `OPENAI_API_KEY` | — | Yes | Used by all agents (model: `gpt-4o`) |
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
