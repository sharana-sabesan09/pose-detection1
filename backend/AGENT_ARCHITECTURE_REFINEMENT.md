# Agent Architecture Refinement

Date: 2026-04-25

## Goal

Keep the current multi-agent shape for now, but make it clinically grounded,
traceable, and compatible with a future full Agentverse rollout.

This document does **not** remove redundant agents yet. It instead changes the
contracts between them so they pass forward verifiable facts, not just prose.

---

## What Is Wrong Right Now

### 1. `progress_agent` sees too little structured evidence

Current input:
- all prior `Summary(agent_name="reporter")` rows
- `AccumulatedScore.fall_risk_avg`
- `AccumulatedScore.reinjury_risk_avg`

Current problem:
- it performs a summary-of-summaries pass on prose only
- it cannot inspect the exact metrics that caused earlier conclusions
- it cannot tell whether a prior summary was based on strong data or thin data
- it cannot explain *which session* caused a milestone or regression
- it writes `Summary(agent_name="progress", session_id=None)`, so the report is
  not linked to a concrete evidence bundle

This is the core traceability problem. The issue is **not** that it summarizes
prior summaries. The issue is that it summarizes prior summaries **without the
supporting structured evidence that produced them**.

### 2. Agent outputs lose provenance as they move downstream

Right now most agents emit:
- one structured output object in memory
- one narrative row in `summaries`
- a few numeric columns in `session_scores`

What is missing:
- upstream source references
- evidence IDs
- metric coverage / quality indicators
- confidence / data sufficiency flags
- a durable machine-readable artifact for later reuse

That means downstream agents cannot distinguish:
- directly observed facts
- deterministic derived metrics
- LLM-written interpretations

### 3. `fall_risk_agent` and `reinjury_risk_agent` are under-specified

They are not wrong because they use an LLM. They are wrong because they are
asked to make broad clinical judgments from narrow inputs.

Current PT-path inputs are too lossy:
- `fall_risk_agent`: pain, target joints, ROM score, flagged joints, joint stats
- `reinjury_risk_agent`: recent fall/ROM score lists plus current flagged joints

These inputs are not rich enough for grounded clinical reasoning.

### 4. RAG is not yet an anchor

If Chroma is empty or ephemeral, "guideline-grounded" reasoning silently
degrades to pure LLM reasoning. That is acceptable as a fallback, but it should
be explicit in artifacts and UI, not hidden.

### 5. The system has no canonical evidence packet

There is no single schema saying:
- what a session fact is
- what an agent is allowed to claim
- which claims are directly measured vs inferred
- which upstream artifacts support each claim

Without that, every downstream prompt is forced to reconstruct context.

---

## Design Principles

1. Summary-of-summaries is allowed.
   The progress layer may summarize prior reporter summaries.

2. Summary-of-summaries is not enough.
   Every summary must travel with the structured evidence that justified it.

3. LLMs should narrate, rank, and explain.
   Deterministic code should compute scores, deltas, thresholds, and salience.

4. Every report must be reproducible.
   For any sentence in a progress report, you should be able to answer:
   - which sessions support it
   - which metrics support it
   - which agent created the supporting claim

5. Agentverse should be an orchestration layer, not a substitute datastore.
   Messages move work. Postgres stores truth.

---

## Proposed Architecture

## A. Introduce a canonical `AgentEvidencePacket`

Every agent should output a durable JSON artifact with the same top-level shape.

Recommended fields:

```json
{
  "artifact_id": "uuid",
  "session_id": "uuid",
  "patient_id": "uuid",
  "agent_name": "fall_risk_agent",
  "artifact_version": "1.0",
  "created_at": "2026-04-25T12:00:00Z",
  "source_type": "pt_session|exercise_session|progress_rollup",
  "upstream_artifact_ids": ["uuid1", "uuid2"],
  "data_coverage": {
    "required_fields_present": true,
    "missing_fields": [],
    "signal_quality": "high|medium|low",
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
    "raw_sources": ["pose_frames", "session_scores", "exercise_sessions"],
    "rag_used": true,
    "rag_query": "",
    "rag_sources": []
  }
}
```

This packet is what downstream agents consume.

## B. Store artifacts separately from narrative summaries

Keep `summaries` for human-readable text, but add a dedicated artifact store.

Recommended new table:
- `agent_artifacts`

Suggested columns:
- `id`
- `session_id`
- `patient_id`
- `agent_name`
- `artifact_kind`
- `artifact_json`
- `created_at`
- `upstream_artifact_ids_json`
- `data_quality_json`

Why:
- `Summary.content` should not be the only durable output
- downstream agents need machine-readable evidence
- audit/replay/debug becomes possible

## C. Redesign `progress_agent` as "salience over summaries + evidence"

Do **not** remove the summary-of-summaries behavior.

Instead, make it operate in four layers:

### Layer 1: deterministic longitudinal fact builder

Build a patient timeline from:
- per-session `SessionScore`
- per-session agent artifacts
- prior reporter summaries
- patient goals / target joints / restrictions
- exercise metrics when available

This stage computes:
- metric deltas over time
- milestone candidates
- regression candidates
- missing-data warnings
- confidence / coverage tags

### Layer 2: deterministic salience selector

Before any LLM call, pick the small set of changes that matter most.

Example salience rules:
- clinically meaningful score delta above threshold
- sustained trend over 3+ sessions
- repeated error pattern across sessions
- goal achieved or missed
- deterioration accompanied by worse pain / worse balance / lower ROM

Output:
- `salient_session_ids`
- `salient_metrics`
- `salient_prior_summaries`
- `why_selected`

### Layer 3: constrained LLM report writer

Only after the fact builder and salience selector run should the LLM write:
- longitudinal report
- overall trend
- milestones reached
- next goals

Prompt policy:
- cite only selected evidence
- do not infer unsupported causes
- explicitly mention data gaps
- emit structured evidence references per section

### Layer 4: traceable progress artifact

Persist:
- chosen sessions
- chosen metrics
- chosen prior summaries
- generated report
- evidence references used for each report section

This preserves the intended summary-of-summaries design while preventing blind
re-summarization.

## D. Change what agents pass downstream

### `intake_agent`

Should pass:
- normalized pain
- target joints
- session goals
- injury side
- rehab phase
- restrictions / contraindications
- confidence that fields were explicit vs inferred

### `pose_analysis_agent`

Should pass:
- joint-level stats
- task label
- sensor / frame quality
- signal coverage
- direct metric values
- threshold breaches

### `fall_risk_agent`

Should pass:
- deterministic score inputs
- risk factors actually present
- evidence packet IDs it used
- narrative explanation constrained to those inputs

### `reinjury_risk_agent`

Should pass:
- session history window used
- trend metrics used
- current-session abnormalities used
- whether the trend is data-sufficient

### `reporter_agent`

Should pass:
- the narrative summary
- section-to-evidence mapping
- claims grouped by theme
- recommendations tied to specific deficits

## E. Gate RAG explicitly

If no relevant clinical context is retrieved:
- mark `rag_used=false`
- say the report was generated without guideline context
- never imply the report is literature-grounded

If RAG is used:
- store source document metadata in the artifact
- store the exact retrieval query

---

## Minimal Implementation Plan

## Phase 1: make outputs durable and machine-readable

Changes:
- add `agent_artifacts` table
- persist one artifact per agent run
- keep existing `summaries` table unchanged

Outcome:
- no behavior change yet
- immediate traceability improvement

## Phase 2: feed artifacts to `progress_agent`

Changes:
- build `ProgressInputPacket` from artifacts + summaries + scores
- stop prompting `progress_agent` with summaries alone
- keep current report shape

Outcome:
- progress remains a summary-of-summaries layer
- but now it has structured evidence to select from

## Phase 3: deterministic salience selector

Changes:
- add a pre-LLM salience pass
- rank sessions / deltas / milestones before report generation

Outcome:
- less repetitive reporting
- fewer unsupported claims
- easier debugging

## Phase 4: evidence-linked reporting

Changes:
- add section-to-evidence mapping in progress artifacts
- optionally surface evidence links in UI / admin tools

Outcome:
- clinician can inspect why the report said what it said

---

## How This Should Work In Agentverse

## Short answer

Yes, the architecture can be moved to Agentverse, but **only if message-passing
is separated from persistence and replay**.

If the hackathon requires Agentverse, the right move is:
- move orchestration and agent-to-agent communication to Agentverse/uAgents
- keep Postgres as the system of record
- keep the mobile app talking to a thin ingress service that writes to DB and
  dispatches an Agentverse job

## What changes if the entire agent infrastructure runs on Agentverse

### 1. Shared in-process DB assumptions break

The current HTTP pipeline relies on:
- one orchestrator function
- one async DB session
- ordered in-process execution

In a full Agentverse topology, agents are separate workers receiving messages.
That means:
- no shared SQLAlchemy session
- no in-memory passing of objects between stages
- no guarantee that downstream agents run immediately

Required change:
- persist artifacts **before** dispatching the next agent
- pass IDs / compact packets over the wire, not Python objects

### 2. Message contracts become product-critical

Every agent needs a stable protocol message:
- `SessionIngested`
- `IntakeArtifactReady`
- `PoseArtifactReady`
- `FallRiskArtifactReady`
- `ReinjuryArtifactReady`
- `ReporterArtifactReady`
- `ProgressRequested`

Each message should carry:
- `job_id`
- `patient_id`
- `session_id`
- `artifact_id`
- `artifact_version`
- retry / dedupe keys

### 3. Idempotency becomes mandatory

Mailbox delivery and distributed retries mean the same job may be seen twice.

Every agent must be safe to re-run:
- check whether its artifact already exists for the same job + version
- return existing artifact instead of creating duplicates

### 4. Payload size must stay small

Do **not** push raw frames or giant session JSON through Agentverse messages.

Instead:
- store raw data in Postgres / object storage
- send artifact IDs and compact summaries through messages

### 5. You need a supervisor / job-state model

The current orchestrator is implicit.
In Agentverse, make it explicit:
- one supervisor/orchestrator agent owns job state
- it dispatches the next stage only after required artifacts exist
- it records terminal success / failure / retry state

Recommended job table:
- `agent_jobs`
- `job_events`

### 6. Progress generation fits Agentverse well

`progress_agent` is a good Agentverse candidate because it is:
- asynchronous
- triggered after enough sessions exist
- not user-latency critical

### 7. Mobile ingress should stay thin

Even in a full Agentverse hackathon submission, I would still keep:
- FastAPI ingress (or a tiny equivalent)
- auth
- DB writes
- dispatch to Agentverse

Reason:
- mobile clients are not a good place to manage signed uAgent envelopes
- ingress is still the clean boundary for auth, validation, and persistence

## Recommended Agentverse topology

### Production shape

1. Mobile app -> thin ingress API
2. Ingress validates and writes session data
3. Ingress creates a `job_id`
4. Ingress dispatches `SessionIngested(job_id, session_id, patient_id)`
5. Agentverse supervisor routes work to the next agent
6. Each agent writes an artifact to Postgres
7. Each agent emits `ArtifactReady(...)`
8. Supervisor decides next transition
9. `progress_agent` runs only when session threshold / trigger condition is met

### Why this is hackathon-safe

- Agent orchestration is genuinely on Agentverse
- agents communicate via protocols / mailbox
- persistence remains reliable and queryable
- you do not rebuild your entire data plane around message envelopes

---

## Recommended Final Shape

For the next implementation pass:

1. Add `agent_artifacts`
2. Introduce per-agent evidence packets
3. Redesign `progress_agent` around salience over summaries + evidence
4. Keep current agents, but change what they pass downstream
5. Add explicit RAG gating and provenance
6. Make all new artifacts idempotent and Agentverse-message-friendly

That yields an architecture that:
- still feels agentic
- still supports summary-of-summaries
- maintains traceability
- reduces hallucination pressure
- can be moved to Agentverse without rewriting the clinical data model

---

## External Validation Notes

This direction is aligned with:
- NIST AI RMF / AI RMF Playbook: documentation, traceability, and provenance
- WHO guidance on LLM use in health: human oversight and caution around
  unsupported outputs
- FDA guidance for clinical decision support: users should be able to review
  the basis of recommendations
- CDC STEADI / NIH PROMIS style assessment thinking: structured clinical inputs
  improve the validity of downstream interpretation
- Fetch.ai / Agentverse docs: mailbox-based agent messaging, protocols, and
  Bureau support distributed multi-agent execution but do not replace durable
  persistence
