# Agent Architecture Notes

Analysis based on running `test_agents.py` against two real squat sessions:
- **message.txt** — 13 reps, session `2026-04-25T16:00:36`, ~38 s
- **message (1).txt** — 20 reps, session `2026-04-25T16:07:08`, ~40 s

Both sessions produced `overallRating: "poor"`. All reps across both sessions were classified `"poor"` except one `"fair"` rep in each session. This is the actual real-world output the architecture needs to handle.

---

## What each agent receives vs. what the data contains

### `intake_agent`

**Receives:** `pt_plan` (string), `pain_scores` (dict), `user_input` (string)

**Problem:** None of these exist in the exercise session schema. To feed the agent at all, `test_agents.py` derives `pain_scores` from error-flag frequencies (e.g., 100% `kneeValgus` rate → `knee_medial: 7.0`). This is a fabrication — it inverts a biomechanical observation into a subjective pain report.

The agent normalises these synthetic scores, extracts `target_joints`, and sets `session_goals`. The goals it will generate (`"Reduce knee valgus"`, `"Improve trunk stability"`) are correct in spirit, but they are downstream of a lossy, invented input. A real patient might squat with consistent valgus and no knee pain at all — or the opposite.

**What would be better:** The intake agent is purpose-built for a clinician-administered PT intake form. For exercise sessions, either (a) skip it entirely and derive joint targets directly from error-flag frequencies, or (b) build a separate `exercise_intake_agent` that takes `ExerciseSessionResult` natively.

---

### `pose_analysis_agent`

**Receives:** Raw `PoseFrame` rows with `angles_json` — expects keys like `hip_flexion`, `knee_flexion`, `lumbar_flexion`, `ankle_dorsiflexion`, etc.

**Problem:** The mobile app does not store raw frames. `test_agents.py` synthesises frames by mapping `kneeFlexionDeg` → `knee_flexion`, `trunkFlexPeak` → `lumbar_flexion`, and approximating `hip_flexion` as `180 - kneeFlexionDeg`. Every other feature is silently dropped:

| Feature in session data | Fate in pose_analysis |
|-------------------------|-----------------------|
| `fppaPeak` / `fppaAtDepth` | **Dropped** — no slot in `angles_json` |
| `pelvicDropPeak` | **Dropped** — no matching joint in `_EXPECTED_ROM` |
| `pelvicShiftPeak` | **Dropped** |
| `hipAdductionPeak` | **Dropped** — 0 on several reps (landmark lost) |
| `kneeOffsetPeak` | **Dropped** |
| `swayNorm` | **Dropped** — the single best fall-risk proxy in the data |
| `smoothness` | **Dropped** |
| `romRatio` | **Dropped** — the normalised depth already computed by the app |
| `confidence` | **Dropped** — all reps treated equally |

The agent's `_EXPECTED_ROM` lookup table (`knee_flexion: 135`, etc.) will flag joints where ROM across all reps is < 40% of the expected value. In message.txt, `kneeFlexionDeg` ranges from **48.9° to 173.3°** across 13 reps — enormous variance that the ROM aggregation will flatten into a mean. No flagging will occur because the mean sits near the expected range even though individual reps are wildly inconsistent.

**Specific data problem — zero `hipAdductionPeak`:** Reps in both sessions show `hipAdductionPeak: 0` (5 reps in message.txt, 7 in message (1).txt). This means the hip landmark was lost during capture, not that the hip is at 0°. If this value ever reached `angles_json`, the agent would treat it as a real measurement and skew joint stats down significantly.

**Specific data problem — noise reps:** In message (1).txt, reps 9–12 have durations of 51–122 ms. A human squat takes at minimum 800–1000 ms. These are likely noise triggers from the rep-detection algorithm. The agent has no mechanism to weight or discard low-confidence or implausibly short reps.

---

### `fall_risk_agent`

**Receives:** `IntakeOutput` (target joints, pain scores, goals) + `PoseAnalysisOutput` (ROM score, flagged joints, joint stats)

**Problem:** This agent has access to the weakest possible signals for fall risk. The exercise data contains three direct fall-risk indicators that never reach the agent:

| Signal | Actual values | Reaches fall_risk_agent? |
|--------|---------------|--------------------------|
| `swayNorm` | 0.001–0.048 across both sessions | **No** |
| `balance` error flag | False for all reps in both sessions | **No** |
| `pelvicDropPeak` | 1.7°–23.9° (>10° is clinically significant) | **No** |

The agent instead uses the RAG-augmented clinical guidelines query built from `flagged_joints` and `pain_scores`. Since `pain_scores` is fabricated and `flagged_joints` is derived from a lossy three-joint frame approximation, the RAG query is also inaccurate.

Ironically, `swayNorm` values in these two sessions (0.001–0.048) suggest very low sway — the subject has good balance despite consistent biomechanical errors. The agent cannot distinguish this from a high-sway patient because the signal is never delivered to it.

---

### `reinjury_risk_agent`

**Receives:** `PoseAnalysisOutput` (current session) + historical `SessionScore` rows for the patient

**Problem — empty history:** `SessionScore` is only populated by the PT pipeline (`POST /sessions/{id}/end`). The exercise pipeline (`POST /sessions/exercise-result`) never writes to `SessionScore`. So for a patient who only does exercise sessions, the reinjury agent will always have an empty trend: `fall_trend=[]`, `rom_trend=[]`. The prompt to the LLM will say `Fall risk trending up: False, ROM trending down: False` because there are no values to compare — which it will misread as stability rather than absence of data.

**Problem — consistency not visible:** The `consistency` field in the session summary (`0.668` for message.txt, `0.623` for message (1).txt) is a direct intra-session variance metric that directly informs reinjury risk (high variance = compensatory patterns = elevated reinjury risk). The agent never sees it.

**Problem — `SessionScore` and `ExerciseSession` are disconnected:** There is currently no mechanism to write exercise session outcomes (classification counts, avg confidence, consistency) into `SessionScore`, so reinjury trend tracking cannot accumulate across exercise sessions.

---

### `reporter_agent`

**Receives:** All prior agent outputs — the synthesised, lossy, approximated chain

**Problem:** The report will be clinically coherent but factually incomplete. The reporter will cite ROM score and flagged joints derived from three synthetic joints, fall risk derived from fabricated pain scores, and reinjury risk with no longitudinal basis. It will not mention:

- `kneeValgus` present on **100% of reps** across both sessions (the single most consistent finding)
- `trunkFlex` present on ≥85% of reps in both sessions
- The bimodal depth distribution (some reps at 50–70°, others at 150–180°) — high variance masked by averaging
- Per-side differences (left vs. right error profiles differ per rep)
- Reps with low confidence being indistinguishable from high-confidence reps in the summary

**What would be better:** Feed `ExerciseSessionResult` directly to the reporter as a structured context block, alongside (or instead of) the synthesised agent chain. The structured features carry far more clinical signal than anything derivable from the current pipeline.

---

### `progress_agent`

**Receives:** All `Summary` rows with `agent_name="reporter"` for a patient, plus `AccumulatedScore`

**Problem:** Progress is tracked in natural language summaries. If the reporter does not mention that `kneeValgus` occurred on 100% of reps (because that signal never reached it), the progress agent cannot track whether valgus is improving over time. The agent is fully dependent on the quality of the reporter's text.

The `AccumulatedScore` weighted average uses `fall_risk_score` and `reinjury_risk_score` from `SessionScore`, which as noted above is never populated by exercise sessions. So for exercise-only patients, `accumulated_scores` will always be `NULL`.

---

## Structural findings

### 1. Two data pipelines that do not communicate

```
Mobile app                 Backend DB                  Agents
──────────                 ──────────                  ──────
ExerciseSessionResult ──▶  exercise_sessions           (never read)
                           rep_analyses                (never read)

POST /sessions/start ──▶   sessions
POST /sessions/frame ──▶   pose_frames          ──▶   pose_analysis_agent
POST /sessions/end   ──▶   session_scores       ──▶   fall_risk_agent
                           summaries            ──▶   reinjury_risk_agent
                                                ──▶   reporter_agent
                                                ──▶   progress_agent
```

The exercise session data (the actual mobile output) is persisted but never read by any agent. The agents read from `pose_frames` which in practice are only populated if the mobile app calls `POST /sessions/frame` — a path that appears unused given the real data.

### 2. `pose_analysis_agent` duplicates work the app does better

The mobile app runs MediaPipe + custom squat analysis on-device, producing 12 biomechanical features per rep with confidence scores. The `pose_analysis_agent` re-derives a single `rom_score` from raw angle frames using a lookup table with fixed expected ROM values. The agent's output is strictly worse than what the app already produced:

| Metric | Mobile app | pose_analysis_agent |
|--------|-----------|---------------------|
| Knee valgus | Detected per rep with confidence | Not detected |
| Depth metric | `romRatio` (normalised to 120°) | ROM range from raw frames |
| Balance | `swayNorm` per rep | Not computed |
| FPPA | Per rep | Not computed |
| Trunk lean | Per rep | Approximated via `lumbar_flexion` |

### 3. The Fetch.ai Agentverse path is architecturally orphaned

There are currently **three** data entry points:

- `POST /sessions/exercise-result` → DB only, no agents
- `POST /sessions/end` → HTTP agent pipeline (direct function calls)
- Agentverse mailbox → uAgent pipeline (typed message-passing)

Paths 2 and 3 run the same logical pipeline with different transport mechanisms. Path 1 is disconnected from both. No documented mechanism routes exercise results into either agent path.

### 4. Confidence is not propagated

Rep-level confidence (0.55–0.96 in the real data) is stored in `rep_analyses.confidence` but never used by any agent. Rep 4 in message.txt has `confidence: 0.55` — below most acceptable thresholds — yet it contributes equally to all aggregations. In message (1).txt, reps 11 and 12 have confidence 0.62 and 0.63 combined with durations of 58 ms and 51 ms, which is anatomically impossible. These should be filtered before any agent processes them.

### 5. `hipAdductionPeak = 0` is a data quality sentinel, not a measurement

Both sessions contain reps with `hipAdductionPeak: 0.0`. This value is a landmark-loss sentinel emitted by the mobile SDK when MediaPipe cannot localise the hip joint. Treating it as 0° of hip adduction would catastrophically skew any hip-related analysis. The backend stores it faithfully but has no validation layer to detect or exclude these.

---

## What should change

| Priority | Change | Rationale |
|----------|--------|-----------|
| High | Add an `exercise_reporter_agent` that takes `ExerciseSessionResult` directly | Bypasses the lossy translation chain entirely |
| High | Write `exercise_sessions` → `SessionScore` bridge | Enables reinjury trend tracking for exercise-only patients |
| High | Filter reps with `confidence < 0.7` and `durationMs < 300` before agent processing | Eliminates noise reps from message (1).txt reps 9–12 |
| High | Add a `hipAdductionPeak == 0` guard in any agent or aggregation that uses that field | Prevents landmark-loss sentinels from polluting analysis |
| Medium | Pass `swayNorm` and `balance` flag to `fall_risk_agent` | These are the best balance signals in the data |
| Medium | Pass `consistency` to `reinjury_risk_agent` | High intra-session variance → elevated reinjury risk |
| Medium | Route exercise session data into the agent pipeline OR deprecate the PT frame-ingestion path | The dual-pipeline split will diverge further over time |
| Low | Retire `pose_analysis_agent` or reduce it to a fallback for raw-frame sessions only | The mobile app produces strictly richer analysis |
| Low | Document the Agentverse path entry point | Currently unreachable from any external caller |
