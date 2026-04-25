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

### Backend (`backend/` — FastAPI + uAgents)

| Layer | Modules |
|-------|---------|
| **Agents** | `orchestrator`, `intake`, `pose_analysis`, `fall_risk`, `reinjury_risk`, `reporter`, `progress`, `hipaa` |
| **RAG** | `rag/loader.py` (ChromaDB ingest), `rag/retriever.py` (query) |
| **DB** | SQLAlchemy async models, Alembic migrations, PostgreSQL |
| **API** | `routers/sessions.py`, `routers/reports.py`, JWT auth |
| **HIPAA** | Presidio PHI scanner + audit log on every agent write |

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
cp .env.example .env       # fill in DATABASE_URL, ANTHROPIC_API_KEY, etc.
uv sync
uv run alembic upgrade head
uv run python run_agent.py
```

API available at `http://localhost:8000`. Docs at `/docs`.

---

## Backend Agent Pipeline

When `POST /sessions/{id}/end` is called:

```
IntakeAgent
    │
PoseAnalysisAgent
    │
    ├── FallRiskAgent ──┐  (parallel)
    └── ReinjuryRiskAgent ─┘
    │
ReporterAgent
    │
ProgressAgent (if 3+ sessions)
```

Every agent output passes through the **HIPAA middleware** (`hipaa_wrap`) which:
1. Scans for PHI using Microsoft Presidio
2. Redacts any found entities
3. Writes an entry to the `audit_log` table

---

## Environment Variables

See `backend/.env.example` for all required variables:

- `DATABASE_URL` — PostgreSQL async URL (`postgresql+asyncpg://...`)
- `OPENAI_API_KEY` — OpenAI API key (used by all agents, model `gpt-4o`)
- `JWT_SECRET` — Secret for signing JWT tokens
- `CHROMA_PERSIST_DIR` — Path to ChromaDB persistence directory
- `AGENTVERSE_MAILBOX_KEY` — uAgents Agentverse mailbox key

---

## Deployment (Railway)

```bash
# From repo root
railway up
```

The `backend/Dockerfile` and `backend/railway.toml` handle everything. Health check at `GET /health`.

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
