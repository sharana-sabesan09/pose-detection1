# Agent Data Requirements

Date: 2026-04-25

## Purpose

This document defines the data each agent should receive from the collection
layer so it can stay grounded and avoid inventing missing clinical state.

The rule is simple:
- if an agent needs a fact often, collect it explicitly
- if a metric can be computed deterministically, compute it before the LLM
- if the data is missing, the artifact must say so

---

## Shared Data Domains

All agents should draw from a common patient/session dataset with four layers.

## 1. Patient baseline

Needed fields:
- `patient_id`
- age
- sex / gender as collected by product policy
- height / weight / BMI
- primary condition / diagnosis <!-- documentation -->
- injury region <!-- voice input -->
- injury side <!-- voice input -->
- ROM restrictions <!-- What patient cant move -->
- fall history <!-- provided by patient -->
- baseline pain <!-- user input -->
- patient goals 
- clinician goals  

## 2. Session context

Needed fields:
- `session_id`
- `patient_id`
- affected side 
- start / end timestamp
- clinician plan <!-- PT Documentation Intake -->
- self-reported symptoms before session
- self-reported symptoms after session
- 

## 3. Measurement layer

Needed fields:
- rep counts
- rep timing
- Left SLS  Features <!-- json -->
- Right SLS Features <!-- json -->
- Left SLS Errors(Threshold breaches) <!-- Voice input pose correction -->
- Right SLS Errors (Threshold breaches) <!-- Voice input pose correction -->
- Right LSD Raw Features  <!-- CSV -->
- Left LSD Raw Features  <!-- CSV -->
- Right LSD Errors <!-- Voice input pose correction -->
- Left LSD Errors <!-- Voice input pose correction -->
- SLS Raw Features & Errors Documentation
- LSD Raw Features & Errors Documentation
- adherence / completion status <!-- subtract overlay from user -->
- SLS injured joint ROM score
- LSD injured joint ROM score

## 4. Longitudinal layer

Needed fields:
- prior sessions used
- session-to-session risk deltas
- session-to-session feature deltas
- session-to-session injured joint deltas
- rolling averages / trends
- goal progress
- milestones reached

---

## Data Contract By Agent

## `intake_agent`

### What it should receive

Required:
- `patient_id`
- age
- sex / gender as collected by product policy
- height / weight / BMI
- primary condition / diagnosis <!-- documentation -->
- injury region <!-- voice input -->
- injury side <!-- voice input -->
- ROM restrictions <!-- What patient cant move -->
- fall history <!-- provided by patient -->
- baseline pain <!-- user input -->
- patient goals 
- clinician goals

Optional:
- free-text notes
- prior imaging / surgery summary

### What should be computed before the agent

Deterministic:
- Left SLS  Features <!-- json -->
- Right SLS Features <!-- json -->
- Left SLS Errors(Threshold breaches) <!-- Voice input pose correction -->
- Right SLS Errors (Threshold breaches) <!-- Voice input pose correction -->
- Right LSD Raw Features  <!-- CSV -->
- Left LSD Raw Features  <!-- CSV -->
- Right LSD Errors <!-- Voice input pose correction -->
- Left LSD Errors <!-- Voice input pose correction -->
- mapping from selected body region to joint codes
- baseline risk flags from intake checklist

### What the agent should output

- normalized pain map
- explicit target joints
- session goals
- explicit-vs-inferred field flags
- intake completeness score

### What is currently missing most often

- injury side
- rehab phase
- restrictions
- explicit goals

---

## `pose_analysis_agent`

### What it should receive

Required:
- `session_id`
- task label (`walking`, `sit_to_stand`, `squat`, etc.)
- normalized time-series or frame data
- affected side if relevant
- frame timestamps
- signal quality metrics

Optional:
- camera placement metadata
- capture environment notes

### Deterministic inputs that should already exist

- joint angles
- rep segmentation if exercise task
- stance / gait phase labels if available
- confidence / visibility summaries

### What it should output

- joint stats
- threshold breaches
- task-specific abnormalities
- signal quality summary
- confidence / coverage indicators

### Additional collection priorities

- landmark dropout rate
- side labeling
- gait symmetry metrics
- sit-to-stand timing
- sway metrics for non-exercise PT sessions

---

## `fall_risk_agent`

### What it should receive

Required:
- `patient_id`
- recent fall history
- assistive device use
- current mobility task metrics
- balance metrics
- gait metrics
- transfer metrics
- pain burden
- medication / dizziness / fear-of-falling flags if collected

Optional:
- orthostatic symptoms
- visual impairment flag
- home hazard flag

### Deterministic inputs that should already exist

- step cadence / rhythm variability
- sway metrics
- transfer duration
- symmetry metrics
- threshold-based risk flags

### What it should output

- fall risk score
- top contributing factors
- confidence / sufficiency flag
- explanation tied to measured factors only

### Highest-value collection gaps

- fall history
- assistive device use
- balance test results
- sit-to-stand / transfer metrics
- fear-of-falling / instability self-report

---

## `reinjury_risk_agent`

### What it should receive

Required:
- `patient_id`
- current session abnormalities
- last N session score history
- side-specific trend metrics
- pain trend
- ROM trend
- load / intensity progression
- adherence / completion trend
- clinician restrictions

Optional:
- intervention changes
- return-to-sport / return-to-function stage

### Deterministic inputs that should already exist

- trend slopes
- moving averages
- percent change from baseline
- consistency / variability measures
- repeated error-pattern frequency

### What it should output

- reinjury risk score
- trend label
- top regression / improvement drivers
- data sufficiency flag

### Highest-value collection gaps

- side-aware longitudinal metrics
- pain-before vs pain-after session
- adherence
- load progression
- rehab phase transitions

---

## `reporter_agent`

### What it should receive

Required:
- current session artifacts from upstream agents
- patient goals / clinician goals
- current deterministic scores
- prior summary context
- evidence references for each major claim

Optional:
- patient quote / subjective complaint
- intervention notes

### Deterministic inputs that should already exist

- salient session findings
- delta from prior session
- quality / completeness flags

### What it should output

- session summary
- highlights
- recommendations
- section-to-evidence mapping
- unsupported-claim count should be zero

### Highest-value collection gaps

- explicit goal linkage
- intervention actually performed
- subjective response to the session

---

## `progress_agent`

### What it should receive

Required:
- prior `reporter` summaries
- per-session structured artifacts
- per-session scores
- patient goals
- baseline values
- milestone candidates
- regression candidates
- session IDs selected for salience

Optional:
- prior progress reports for display only

### Deterministic inputs that should already exist

- longitudinal fact table
- metric deltas
- rolling averages
- salient changes
- data sufficiency / missingness summary

### What it should output

- longitudinal report
- overall trend
- milestones reached
- next goals
- evidence links to sessions and artifacts used

### Highest-value collection gaps

- explicit baseline / target goals
- intervention changes over time
- adherence trend
- side-specific movement trends
- confidence / coverage history

---

## `exercise_reporter_agent`

### What it should receive

Required:
- `exercise`
- `session_id`
- `patient_id`
- rep count
- per-rep side
- per-rep timing
- per-rep confidence
- per-rep biomechanical features
- per-rep error flags
- session consistency
- frame quality summary

Optional:
- pain before / after exercise
- task cueing used
- load / resistance level

### Deterministic inputs that should already exist

- rep filtering
- feature stats
- error frequencies
- side-specific aggregates
- fall / reinjury / ROM scores

### What it should output

- grounded exercise summary
- highlights
- recommendations
- explicit dominant errors
- session quality notes

### Highest-value collection gaps

- left/right split rollups
- pain change with exercise
- resistance / load
- cueing context
- frame / landmark quality metadata

---

## `progress_agent` and `reporter_agent` Should Never Depend On

These should not be primary sources:
- prior prose alone
- empty RAG responses
- inferred injury side
- inferred rehab phase
- inferred adherence
- inferred intervention changes

If these are missing, the report should say they are missing.

---

## Collection Backlog Ranked By Value

## Highest priority

1. Injury side
2. Rehab phase
3. Explicit patient / clinician goals
4. Fall history
5. Assistive device use
6. Pain before and after session
7. Signal quality / landmark dropout summary
8. Side-specific per-session aggregates

## Medium priority

1. Adherence / completion
2. Intervention performed
3. Load / resistance
4. Fear-of-falling / instability self-report
5. Medication / dizziness flags

## Lower priority

1. Home hazard context
2. Imaging / surgery summary
3. Environmental capture metadata

---

## Minimum Viable Data Package For A Grounded System

If the project only implements the minimum set next, collect:

- `patient_id`
- injury region
- injury side
- rehab phase
- patient goals
- clinician goals
- fall history
- assistive device use
- pre-session pain
- post-session pain
- task / exercise label
- side-specific rep metrics
- per-session quality / confidence summary
- prior session score history

That package is enough to materially reduce hallucination pressure across the
current agents without deleting any of them.
