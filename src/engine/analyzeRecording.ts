/**
 * src/engine/analyzeRecording.ts — BATCH ANALYSIS OF A RECORDED SESSION
 *
 * The live detectors use rolling 5–10 second windows because they have to
 * work in real time and can't look ahead. This batch analyzer has the luxury
 * of seeing the FULL recording — up to 60 seconds of pose data — before making
 * any judgment. This produces more accurate, stable scores than the live view.
 *
 * WHAT THIS DOES:
 *   Given an array of timestamped pose frames collected during recording,
 *   it computes the same 6 clinical measurements and 5 dashboard scores,
 *   but using the entire dataset at once rather than a rolling window.
 *
 *   It also extracts plain-English "key findings" — short sentences that
 *   describe the most clinically significant observations from the recording.
 *   These show up on the Dashboard screen as the "crafted" analysis.
 *
 * OUTPUT — AnalysisResult:
 *   scores       — the same 5 RiskScores (0–100) as the live dashboard
 *   metrics      — raw numbers (step count, CV, sway range) for display
 *   findings     — ["Step rhythm is irregular", "Lateral sway is within normal range"]
 *   riskLevel    — 'low' | 'moderate' | 'high' | 'critical' for the overall score
 */

import { PoseFrame, RiskScores } from '../types';
import { LM } from './landmarks';
import { aggregateScores } from './scoreAggregator';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** A single captured moment: the pose at a specific timestamp. */
export interface RecordedFrame {
  t:    number;     // Unix timestamp in milliseconds when this frame was captured
  pose: PoseFrame;  // The 33 MediaPipe landmarks at that moment
}

/**
 * AnalysisResult — EVERYTHING WE KNOW AFTER ANALYZING A RECORDING
 *
 * Saved to AsyncStorage so the Dashboard can show history.
 */
export interface AnalysisResult {
  id:          string;   // ISO timestamp string — serves as a unique ID
  date:        string;   // Human-readable: "Apr 23 at 3:45 PM"
  durationSec: number;   // How many seconds were actually recorded

  scores: RiskScores;    // The 5 dashboard scores (0–100, higher = safer)

  metrics: {
    totalSteps:      number;  // How many steps were detected in the recording
    stepRhythmCV:    number;  // Coefficient of variation of step intervals (lower = better)
    maxLateralSway:  number;  // Largest side-to-side hip range observed (screen fraction)
    stabilityScore:  number;  // Average CoG stability across the recording (0–100)
  };

  findings: string[];  // Plain-English summary sentences for the Dashboard
  riskLevel: 'low' | 'moderate' | 'high' | 'critical';
}

// ─────────────────────────────────────────────────────────────────────────────
// MATH HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;
}

function variance(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function scoreToRiskLevel(s: number): 'low' | 'moderate' | 'high' | 'critical' {
  if (s >= 75) return 'low';
  if (s >= 50) return 'moderate';
  if (s >= 25) return 'high';
  return 'critical';
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE ANALYSIS FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * analyzeRecording() — THE MAIN BATCH ANALYSIS ENTRY POINT
 *
 * Call this after a recording session ends with all captured frames.
 * Returns a complete AnalysisResult ready to display on the Dashboard.
 *
 * @param frames            All recorded {t, pose} pairs (up to ~1800 for 60s at 30fps)
 * @param demographicRisk   0–100 from the user's intake form (0 = no demographic risk)
 */
export function analyzeRecording(
  frames: RecordedFrame[],
  demographicRisk: number,
): AnalysisResult {

  // ── Guard: need at least 30 frames (~1 second) to say anything useful ──
  if (frames.length < 30) {
    return buildEmptyResult('Recording too short to analyze');
  }

  const durationSec = (frames[frames.length - 1].t - frames[0].t) / 1000;

  // ── Extract raw signals from the full frame array ─────────────────────────
  const cogs        = extractCoG(frames);           // hip midpoints over time
  const ankleDiffs  = extractAnkleDiff(frames);     // step detection signal
  const hipXs       = cogs.map(c => c.x);           // lateral positions

  // ── Compute each measurement over the full dataset ────────────────────────
  const { stepRhythm, totalSteps, stepRhythmCV } = computeStepRhythm(ankleDiffs, frames);
  const { lateralTrunkSway, maxLateralSway }      = computeLateralSway(hipXs);
  const { standingStability, stabilityScore }     = computeStability(cogs);
  const nudgeRecovery                             = computeNudgeRecovery(cogs);

  // Transition scores: default to neutral (batch analysis doesn't track sit-stand events)
  const standupDuration  = 50;
  const postStandWobble  = 50;

  // ── Aggregate into the 5 dashboard scores ─────────────────────────────────
  const scores = aggregateScores(
    { standingStability, lateralTrunkSway, stepRhythm, standupDuration, postStandWobble, nudgeRecovery },
    demographicRisk,
  );

  // ── Generate plain-English findings ───────────────────────────────────────
  const findings = generateFindings(
    scores, totalSteps, stepRhythmCV, maxLateralSway, durationSec
  );

  const now = new Date();
  return {
    id:          now.toISOString(),
    date:        formatDate(now),
    durationSec: Math.round(durationSec),
    scores,
    metrics:     { totalSteps, stepRhythmCV, maxLateralSway, stabilityScore },
    findings,
    riskLevel:   scoreToRiskLevel(scores.overallFallRisk),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNAL EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────

/** Extract centre-of-gravity (hip midpoint x, y) for every frame. */
function extractCoG(frames: RecordedFrame[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const { pose } of frames) {
    const lh = pose[LM.LEFT_HIP];
    const rh = pose[LM.RIGHT_HIP];
    if (!lh || !rh) continue;
    if ((lh.visibility ?? 1) < 0.3 || (rh.visibility ?? 1) < 0.3) continue;
    out.push({ x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 });
  }
  return out;
}

/**
 * Extract the ankle differential signal for every frame.
 * Value = leftAnkle.y − rightAnkle.y
 * Positive → left foot lower (planted), right foot lifted
 * Negative → right foot lower, left foot lifted
 * Zero crossings → step transition events
 */
function extractAnkleDiff(frames: RecordedFrame[]): { t: number; diff: number }[] {
  const out: { t: number; diff: number }[] = [];
  for (const { t, pose } of frames) {
    const la = pose[LM.LEFT_ANKLE];
    const ra = pose[LM.RIGHT_ANKLE];
    if (!la || !ra) continue;
    if ((la.visibility ?? 1) < 0.3 || (ra.visibility ?? 1) < 0.3) continue;
    out.push({ t, diff: la.y - ra.y });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// MEASUREMENTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * STEP RHYTHM CONSISTENCY
 *
 * Detects zero-crossings of the ankle differential signal.
 * Each zero-crossing is a step transition.
 * CV (coefficient of variation) of intervals measures regularity.
 */
function computeStepRhythm(
  ankleDiffs: { t: number; diff: number }[],
  _frames: RecordedFrame[],
): { stepRhythm: number; totalSteps: number; stepRhythmCV: number } {

  const intervals: number[] = [];
  let prevSign        = 0;
  let lastCrossingT   = 0;

  for (const { t, diff } of ankleDiffs) {
    // ±0.015 deadband prevents noise from triggering false step detections
    const sign = diff > 0.015 ? 1 : diff < -0.015 ? -1 : 0;

    if (sign !== 0 && sign !== prevSign) {
      // Sign change = step transition
      if (prevSign !== 0 && lastCrossingT > 0) {
        const interval = t - lastCrossingT;
        // Filter: a realistic step takes 200ms–2500ms
        if (interval > 200 && interval < 2500) {
          intervals.push(interval);
        }
      }
      lastCrossingT = t;
      prevSign      = sign;
    }
  }

  if (intervals.length < 4) {
    // Not enough steps to characterise rhythm — return neutral
    return { stepRhythm: 50, totalSteps: intervals.length, stepRhythmCV: 0 };
  }

  const m   = mean(intervals);
  const cv  = m > 0 ? Math.sqrt(variance(intervals)) / m : 0;

  /**
   * Scoring:
   *   CV = 0.0  → perfectly regular (score 100)
   *   CV = 0.15 → healthy walking range (score ~70)
   *   CV = 0.30 → moderate irregularity (score ~40)
   *   CV >= 0.5 → very irregular (score 0)
   *
   * Source: Rivolta 2019 used step rhythm CV as their strongest predictor
   */
  const stepRhythm = clamp(100 * (1 - cv / 0.5), 0, 100);
  const totalSteps = Math.floor(intervals.length / 2); // each full step = 2 crossings

  return { stepRhythm, totalSteps, stepRhythmCV: Math.round(cv * 100) / 100 };
}

/**
 * LATERAL TRUNK SWAY
 *
 * Measures the maximum side-to-side range of the hip midpoint.
 * Analysed in 5-second windows across the full recording to avoid
 * penalising the user for naturally walking across the frame.
 * We use the MEDIAN window range rather than the global range.
 */
function computeLateralSway(
  hipXs: number[],
): { lateralTrunkSway: number; maxLateralSway: number } {

  if (hipXs.length < 20) return { lateralTrunkSway: 70, maxLateralSway: 0 };

  // Split into ~5-second windows (assuming ~30fps, window = 150 frames)
  const windowSize = 150;
  const ranges: number[] = [];
  for (let i = 0; i + windowSize <= hipXs.length; i += windowSize) {
    const window = hipXs.slice(i, i + windowSize);
    ranges.push(Math.max(...window) - Math.min(...window));
  }

  if (ranges.length === 0) {
    const r = Math.max(...hipXs) - Math.min(...hipXs);
    ranges.push(r);
  }

  // Use median to ignore outlier windows (e.g., user stepped out of frame)
  ranges.sort((a, b) => a - b);
  const medianRange = ranges[Math.floor(ranges.length / 2)];
  const maxRange    = Math.max(...ranges);

  // Score: range 0.04–0.10 is healthy walking, >0.15 is elevated risk
  let score: number;
  if (medianRange <= 0.04)      score = 72;
  else if (medianRange <= 0.10) score = 100 - ((medianRange - 0.04) / 0.06) * 25;
  else if (medianRange <= 0.18) score = 75 - ((medianRange - 0.10) / 0.08) * 40;
  else                          score = Math.max(0, 35 - ((medianRange - 0.18) / 0.10) * 35);

  return {
    lateralTrunkSway: clamp(score, 0, 100),
    maxLateralSway:   Math.round(maxRange * 1000) / 1000,
  };
}

/**
 * STANDING STABILITY
 *
 * Measures CoG variance across quiet standing windows.
 * We identify "quiet" windows by looking for periods where the total
 * CoG movement range is small (< 0.04 in both x and y).
 */
function computeStability(
  cogs: { x: number; y: number }[],
): { standingStability: number; stabilityScore: number } {

  if (cogs.length < 30) return { standingStability: 50, stabilityScore: 50 };

  const windowSize = 90; // ~3 seconds at 30fps
  const windowScores: number[] = [];

  for (let i = 0; i + windowSize <= cogs.length; i += windowSize) {
    const window = cogs.slice(i, i + windowSize);
    const xs = window.map(p => p.x);
    const ys = window.map(p => p.y);
    const rangeX = Math.max(...xs) - Math.min(...xs);
    const rangeY = Math.max(...ys) - Math.min(...ys);

    // Only score this window if the person was relatively still
    // (not walking across the frame — that would inflate the range)
    if (rangeX < 0.08 && rangeY < 0.08) {
      const totalVar = variance(xs) + variance(ys);

      let s: number;
      if      (totalVar < 0.000005) s = 65;
      else if (totalVar <= 0.0003)  s = 75 + 25 * (1 - totalVar / 0.0003);
      else if (totalVar <= 0.001)   s = 75 - ((totalVar - 0.0003) / 0.0007) * 25;
      else                          s = Math.max(0, 50 - ((totalVar - 0.001) / 0.002) * 50);

      windowScores.push(clamp(s, 0, 100));
    }
  }

  if (windowScores.length === 0) return { standingStability: 50, stabilityScore: 50 };

  const avg = mean(windowScores);
  return {
    standingStability: clamp(avg, 0, 100),
    stabilityScore:    Math.round(avg),
  };
}

/** NUDGE RECOVERY — lateral vs sagittal sway ratio over the full recording. */
function computeNudgeRecovery(cogs: { x: number; y: number }[]): number {
  if (cogs.length < 20) return 65;

  const xs = cogs.map(c => c.x);
  const ys = cogs.map(c => c.y);
  const rangeX = Math.max(...xs) - Math.min(...xs);
  const rangeY = Math.max(...ys) - Math.min(...ys);

  if (rangeY < 0.01) return 65;

  const ratio = rangeX / rangeY;
  if (ratio < 0.5)       return 95;
  else if (ratio <= 1.0) return 95 - ((ratio - 0.5) / 0.5) * 25;
  else if (ratio <= 1.5) return 70 - ((ratio - 1.0) / 0.5) * 35;
  else                   return Math.max(0, 35 - ((ratio - 1.5) / 1.0) * 35);
}

// ─────────────────────────────────────────────────────────────────────────────
// KEY FINDINGS GENERATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * generateFindings() — TURN NUMBERS INTO PLAIN-ENGLISH OBSERVATIONS
 *
 * The Dashboard shows these as bullet points under the score breakdown.
 * They follow the Tinetti assessment language — clinical but accessible.
 */
function generateFindings(
  scores: RiskScores,
  totalSteps: number,
  stepRhythmCV: number,
  maxLateralSway: number,
  durationSec: number,
): string[] {
  const f: string[] = [];

  // ── Overall ───────────────────────────────────────────────────────────────
  if (scores.overallFallRisk >= 75) {
    f.push('Overall movement pattern looks strong — low fall risk detected.');
  } else if (scores.overallFallRisk >= 50) {
    f.push('Moderate fall risk detected — some movement patterns warrant attention.');
  } else {
    f.push('Elevated fall risk indicators found — consider consulting your physiotherapist.');
  }

  // ── Step rhythm ───────────────────────────────────────────────────────────
  if (totalSteps > 4) {
    if (stepRhythmCV < 0.12) {
      f.push(`Step timing is very consistent (${totalSteps} steps, CV ${stepRhythmCV.toFixed(2)}) — excellent gait regularity.`);
    } else if (stepRhythmCV < 0.25) {
      f.push(`Step timing shows mild variability (CV ${stepRhythmCV.toFixed(2)}) — try to maintain an even cadence.`);
    } else {
      f.push(`Step timing is irregular (CV ${stepRhythmCV.toFixed(2)}) — this is the strongest fall risk indicator found.`);
    }
  } else {
    f.push('Not enough walking detected to assess step rhythm — try walking mode for a full minute.');
  }

  // ── Lateral sway ──────────────────────────────────────────────────────────
  if (scores.lateralSway >= 75) {
    f.push('Side-to-side hip movement is well-controlled during walking.');
  } else if (scores.lateralSway >= 50) {
    f.push('Slightly elevated lateral hip sway — focus on hip stability exercises.');
  } else {
    f.push('Significant lateral trunk sway detected — hip muscle weakness may be contributing.');
  }

  // ── Balance stability ─────────────────────────────────────────────────────
  if (scores.balanceStability >= 75) {
    f.push('Standing balance is steady — centre of gravity stays well-controlled.');
  } else if (scores.balanceStability >= 50) {
    f.push('Moderate sway while standing — consider balance training exercises.');
  } else {
    f.push('Notable postural sway while standing — a walking aid may be beneficial.');
  }

  // ── Recording quality ─────────────────────────────────────────────────────
  if (durationSec < 20) {
    f.push('Recording was under 20 seconds — a longer recording will give more accurate results.');
  }

  return f;
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTENCE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'sentinel_analyses';
const MAX_SAVED   = 10; // Keep the 10 most recent analyses

/** Save a new analysis result to AsyncStorage, keeping up to MAX_SAVED. */
export async function saveAnalysis(result: AnalysisResult): Promise<void> {
  const existing = await loadAnalyses();
  const updated  = [result, ...existing].slice(0, MAX_SAVED);
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

/** Load all saved analyses from AsyncStorage, newest first. */
export async function loadAnalyses(): Promise<AnalysisResult[]> {
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  return JSON.parse(raw) as AnalysisResult[];
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

function buildEmptyResult(reason: string): AnalysisResult {
  return {
    id:          new Date().toISOString(),
    date:        formatDate(new Date()),
    durationSec: 0,
    scores:      { balanceStability:50, transitionSafety:50, gaitRegularity:50, lateralSway:50, overallFallRisk:50 },
    metrics:     { totalSteps:0, stepRhythmCV:0, maxLateralSway:0, stabilityScore:50 },
    findings:    [reason],
    riskLevel:   'moderate',
  };
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}
