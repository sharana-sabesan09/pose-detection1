/**
 * src/engine/scoreAggregator.ts — COMBINE 6 MEASUREMENTS INTO 5 DASHBOARD SCORES
 *
 * This is the final step before the numbers hit the screen.
 * The six raw detector measurements are combined (with clinical weights)
 * into the five scores the user actually sees.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCORING PHILOSOPHY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * All scores are 0–100 where HIGHER = SAFER:
 *   75–100 → Green  — Low risk, safe to continue
 *   50–74  → Yellow — Moderate risk, proceed with caution
 *   25–49  → Orange — High risk, consider stopping
 *   0–24   → Red    — Critical, stop immediately
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WEIGHTS (from Rivolta et al. 2019 + Tinetti scale)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   Balance Stability  → 20% of Overall
 *   Transition Safety  → 20% of Overall
 *   Gait Regularity    → 25% of Overall  ← highest because r=0.65 with Tinetti
 *   Lateral Sway       → 20% of Overall
 *   Demographic safety → 15% of Overall  ← from intake form (age, gender, BMI)
 *
 *   Total = 100%
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INACTIVE SCORES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * From the PRD: "Inactive scores are shown dimmed with the last known value
 * rather than reset to zero."
 *
 * The aggregator always computes all five scores from whatever data it has.
 * The ScoreDashboard component (not this file) decides which boxes to dim
 * based on the current mode.
 */

import { RiskScores } from '../types';
import { RawMeasurements } from './detectors';

/** Clamp helper — keeps values in [0, 100] and rounds to nearest integer. */
function score(v: number): number {
  return Math.round(Math.max(0, Math.min(100, v)));
}

/**
 * aggregateScores() — THE SINGLE FUNCTION THAT TURNS MEASUREMENTS INTO SCORES
 *
 * Called every frame from SessionScreen after PoseDetectors.update().
 *
 * @param m                   The six raw measurements from PoseDetectors
 * @param demographicRiskScore  0–100 from the intake form (HIGHER = MORE RISKY)
 *                              This is INVERTED below because all other scores
 *                              are safety scores (HIGHER = SAFER).
 */
export function aggregateScores(
  m: RawMeasurements,
  demographicRiskScore: number,
): RiskScores {

  // ── The demographic score from intake is a RISK score (higher = more risky).
  // Convert it to a SAFETY score so all terms point the same direction.
  const demographicSafety = 100 - demographicRiskScore;

  // ── BALANCE STABILITY ──────────────────────────────────────────────────────
  // How steadily the person is standing still right now.
  // Combines standing stability (primary) with nudge recovery (secondary).
  // Weights: 70% stability, 30% recovery ratio.
  const balanceStability = score(
    0.70 * m.standingStability +
    0.30 * m.nudgeRecovery
  );

  // ── TRANSITION SAFETY ──────────────────────────────────────────────────────
  // How safely the person moves from sitting to standing.
  // Standup duration is the primary signal (clinical 3-second threshold).
  // Post-stand wobble catches the dangerous 5-second window after rising.
  // Weights: 60% duration, 40% wobble.
  const transitionSafety = score(
    0.60 * m.standupDuration +
    0.40 * m.postStandWobble
  );

  // ── GAIT REGULARITY ────────────────────────────────────────────────────────
  // How even and rhythmic the walking pattern is.
  // Directly derived from step rhythm CV (coefficient of variation).
  // This is the SINGLE STRONGEST predictor of fall risk in the Rivolta 2019 study
  // (Pearson r = 0.65 with Tinetti score), which is why it gets the highest weight.
  const gaitRegularity = score(m.stepRhythm);

  // ── LATERAL SWAY ───────────────────────────────────────────────────────────
  // How controlled the side-to-side hip movement is during walking.
  // Second strongest predictor in the Rivolta study.
  const lateralSway = score(m.lateralTrunkSway);

  // ── OVERALL FALL RISK ──────────────────────────────────────────────────────
  // The headline score — a single number that summarises everything.
  // Weights match the clinical evidence (gait regularity gets 25%, others 20%,
  // demographic contribution 15%).
  const overallFallRisk = score(
    0.20 * balanceStability  +
    0.20 * transitionSafety  +
    0.25 * gaitRegularity    +
    0.20 * lateralSway       +
    0.15 * demographicSafety
  );

  return {
    balanceStability,
    transitionSafety,
    gaitRegularity,
    lateralSway,
    overallFallRisk,
  };
}

/**
 * scoreColor() — MAP A SCORE TO ITS DASHBOARD COLOUR
 *
 * Used by ScoreDashboard to colour each score box.
 * Exported here (next to the threshold logic) so the colour rules
 * are defined in one place only.
 */
export function scoreColor(s: number): string {
  if (s >= 75) return '#4caf50';  // Green  — Low risk
  if (s >= 50) return '#f0a500';  // Yellow — Moderate risk
  if (s >= 25) return '#ff6d00';  // Orange — High risk
  return '#f44336';               // Red    — Critical
}

/**
 * scoreLabel() — BRIEF RISK LABEL FOR A GIVEN SCORE
 * Used as the subtitle under each number in the dashboard.
 */
export function scoreLabel(s: number): string {
  if (s >= 75) return 'Low risk';
  if (s >= 50) return 'Moderate';
  if (s >= 25) return 'High risk';
  return 'Critical';
}
