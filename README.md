# Sentinel — AI-Powered Physical Therapy Assistant

A React Native mobile app + Python FastAPI backend for real-time pose detection, fall risk assessment, and longitudinal PT progress tracking.

---

## Architecture

```
┌─────────────────────────────┐       ┌──────────────────────────────────────┐
│  React Native App (mobile)  │──────▶│  FastAPI Backend  (Python 3.11+)     │
│                             │  JWT  │                                      │
│  • Live camera pose capture │◀──────│  • Multi-agent clinical pipeline     │
│  • Real-time risk scores    │       │  • HIPAA-compliant PHI redaction      │
│  • Session recording        │       │  • RAG over clinical guidelines       │
│  • Progress dashboard       │       │  • PostgreSQL + ChromaDB              │
└─────────────────────────────┘       └──────────────────────────────────────┘
```

### Mobile (React Native + TypeScript)

| File | Purpose |
|------|---------|
| `App.tsx` | Root navigator — Intake once, then Main tabs |
| `src/screens/SessionScreen.tsx` | Live camera, skeleton overlay, score dashboard, recording |
| `src/screens/DashboardScreen.tsx` | Analysis history |
| `src/screens/IntakeScreen.tsx` | One-time patient profile collection |
| `src/engine/detectors.ts` | Pose detectors: balance, transition, gait, lateral sway |
| `src/engine/scoreAggregator.ts` | Weighted risk score aggregation |
| `src/engine/analyzeRecording.ts` | Post-session analysis pipeline |
| `src/components/ScoreDashboard.tsx` | Live score display component |
| `src/components/SkeletonOverlay.tsx` | 33-point MediaPipe skeleton renderer |

### Backend (`backend/` — FastAPI + Fetch.ai uAgents)

| Layer | Modules |
|-------|---------|
| **Agents** | `orchestrator`, `intake`, `pose_analysis`, `fall_risk`, `reinjury_risk`, `reporter`, `progress`, `hipaa` |
| **Fetch.ai** | `agentverse_agent.py` (orchestrator uAgent), `bureau.py` (runs all agents), `messages.py` (typed message models) |
| **RAG** | `rag/loader.py` (ChromaDB ingest), `rag/retriever.py` (query) |
| **DB** | SQLAlchemy async models, Alembic migrations, PostgreSQL |
| **API** | `routers/sessions.py`, `routers/reports.py`, `routers/exports.py`, JWT auth |
| **HIPAA** | Presidio PHI scanner + audit log on every agent write |

See [`backend/BACKEND.md`](backend/BACKEND.md) for the full technical reference — data models, all API endpoints, agent pipeline internals, RAG setup, and Railway deployment detail.

---

## Quick Start

### Mobile

```bash
npm install
npx react-native run-ios   # or run-android
```

### Backend

```bash
cd backend
cp .env.example .env       # fill in GEMINI_API_KEY at minimum
uv sync                    # install dependencies (uses uv lockfile)
uv run python run_agent.py # starts FastAPI (port 8000) + Fetch.ai Bureau
```

API available at `http://localhost:8000`. Docs at `/docs`.

`python run_agent.py` starts both the FastAPI server (port 8000) and the Fetch.ai Bureau (all 7 uAgents) in one process.

---

## Mobile Upload Path

At the end of recording, the React Native app now uploads completed exercise
sessions through the production ingest flow:

1. `POST /auth/token`
2. `POST /sessions/exercise-result`

That upload persists the mobile schema to `exercise_sessions.summary_json`,
stores per-rep rows in `rep_analyses`, stores the uploaded CSV artifacts in
`exercise_sessions.reps_csv` and `exercise_sessions.frame_features_csv`, and
parses frame-feature rows into `pose_frames` via the linked companion
`sessions` row.

`POST /exports/session` remains available only as a dev-only local artifact
dump. It is no longer the primary mobile upload path.

---

## Backend Agent Pipeline

Each agent is a proper Fetch.ai **uAgent** with its own identity, running inside a shared `Bureau`. The `physio-orchestrator` is the only agent exposed to Agentverse (via mailbox key); sub-agents are local and communicate via typed messages.

### Two execution paths

**HTTP path** (FastAPI endpoints):
```
POST /sessions/{id}/end → orchestrator.py → run_intake() → run_pose_analysis() → ...
```
Direct Python function calls — no Fetch.ai involved.

**Agentverse path** (uAgents message-passing):
```
External Agentverse message
    → physio-orchestrator (mailbox)
        → ctx.send → intake-agent
        → ctx.send → pose-analysis-agent
        → ctx.send → fall-risk-agent  ┐ (parallel)
        → ctx.send → reinjury-agent   ┘
        → ctx.send → reporter-agent
        → ctx.send → progress-agent (if 3+ sessions)
    → SessionResponseMessage back to caller
```

### Pipeline order

```
intake-agent
    │
pose-analysis-agent
    │
    ├── fall-risk-agent ────┐  (parallel, both must respond before continuing)
    └── reinjury-risk-agent ┘
    │
reporter-agent
    │
progress-agent (if patient has 3+ sessions)
```

Every agent output passes through the **HIPAA middleware** (`hipaa_wrap`) which:
1. Scans for PHI using Microsoft Presidio
2. Redacts any found entities
3. Writes an entry to the `audit_log` table

### Fetch.ai files

| File | Purpose |
|------|---------|
| `agents/messages.py` | Typed `uagents.Model` message classes for all agent communication |
| `agents/agentverse_agent.py` | Orchestrator uAgent — dispatches via `ctx.send()`, manages pipeline state |
| `agents/bureau.py` | Assembles all 7 uAgents into a `Bureau` for single-process execution |
| `agents/intake.py` | `intake_agent` + `on_message(IntakeRequest)` handler |
| `agents/pose_analysis.py` | `pose_agent` + `on_message(PoseRequest)` handler |
| `agents/fall_risk.py` | `fall_risk_agent` + `on_message(FallRiskRequest)` handler |
| `agents/reinjury_risk.py` | `reinjury_agent` + `on_message(ReinjuryRiskRequest)` handler |
| `agents/reporter.py` | `reporter_agent` + `on_message(ReporterRequest)` handler |
| `agents/progress.py` | `progress_agent` + `on_message(ProgressRequest)` handler |

---

## Environment Variables

See `backend/.env.example` for all required variables:

- `DATABASE_URL` — PostgreSQL async URL (`postgresql+asyncpg://...`)
- `OPENAI_API_KEY` — OpenAI API key (used by general agents: intake, fall risk, reinjury risk, reporter, progress — model `gpt-4o`)
- `GEMINI_API_KEY` — Google Gemini API key (used by `exercise_reporter` for clinical biomechanics analysis — model `gemini-2.0-flash`). Get one at [aistudio.google.com](https://aistudio.google.com).
- `JWT_SECRET` — Secret for signing JWT tokens
- `CHROMA_PERSIST_DIR` — Path to ChromaDB persistence directory
- `AGENTVERSE_MAILBOX_KEY` — Fetch.ai Agentverse mailbox key for the orchestrator agent (get one at agentverse.ai)

---

## Deployment (Railway)

```bash
# From repo root
railway up
```

The `backend/Dockerfile` and `backend/railway.toml` handle the build. Before deploying, set the following Railway environment variables:

| Variable | Notes |
|----------|-------|
| `DATABASE_URL` | `postgresql+asyncpg://...` — use Railway's PostgreSQL plugin URL, rewritten to the asyncpg scheme |
| `OPENAI_API_KEY` | General agents (intake, fall risk, reinjury risk, reporter, progress) |
| `GEMINI_API_KEY` | `exercise_reporter` agent — Google AI Studio key |
| `JWT_SECRET` | Random 64-char string |
| `CHROMA_PERSIST_DIR` | `/app/chroma_db` — mount a Railway volume here for persistence across deploys |
| `AGENTVERSE_MAILBOX_KEY` | Optional — enables the Fetch.ai Agentverse path |
| `DEV_MODE` | `False` — enforces JWT auth and disables the dev-only exports endpoint |

Railway runs `alembic upgrade head` as a release command before cutting over traffic, so migrations are applied automatically on each deploy. Health check at `GET /health`.

For more detail see [`backend/BACKEND.md`](backend/BACKEND.md).

---

## Risk Score Methodology

| Score | Source | Weight in Overall |
|-------|--------|------------------|
| Gait Regularity | Step rhythm consistency | 25% |
| Balance Stability | Static sway detection | 20% |
| Transition Safety | Sit-to-stand duration + wobble | 20% |
| Lateral Sway | Hip swing amplitude | 20% |
| Demographic Risk | Age, BMI, gender (intake) | 15% |

Colour coding: Green ≥75 · Yellow 50–74 · Orange 25–49 · Red <25

---

## License

MIT
