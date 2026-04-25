/**
 * src/engine/detectors.ts — THE SIX CLINICAL MEASUREMENTS
 *
 * This file is the mathematical heart of SENTINEL.
 * It converts raw landmark positions into clinically meaningful numbers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BIG PICTURE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Every time MediaPipe delivers a new pose frame (~30fps), `PoseDetectors.update()`
 * is called. It feeds the frame into whichever detectors are relevant for the
 * current mode, and produces six "raw measurements" — each a number 0–100
 * where HIGHER means SAFER.
 *
 * Those six measurements are then passed to the Score Aggregator (scoreAggregator.ts)
 * which combines them into the five scores shown on the dashboard.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SIX MEASUREMENTS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. STANDING STABILITY  (Standing mode)
 *    How much does the person's centre of gravity move while standing still?
 *    A healthy person has small, regular micro-movements (~1–3mm sway).
 *    Too much sway = risky. Abnormally rigid stillness = also a warning sign.
 *
 * 2. LATERAL TRUNK SWAY  (Walking mode)
 *    How far does the midpoint of the hips swing side-to-side while walking?
 *    Some lateral sway is normal. Excessive sway (>15% of screen width)
 *    indicates hip muscle weakness or compensation for a painful side.
 *    Second strongest predictor in Rivolta 2019 study.
 *
 * 3. STEP RHYTHM CONSISTENCY  (Walking mode)
 *    How regular is the timing between left steps and right steps?
 *    Irregular rhythm — some steps quick, some slow — is the SINGLE STRONGEST
 *    predictor of fall risk (correlation 0.65 with Tinetti score, Rivolta 2019).
 *    Measured using zero-crossings of the ankle differential signal.
 *
 * 4. STAND-UP DURATION  (Transition mode)
 *    How long does it take to rise from a chair to fully upright?
 *    Clinical reference (Tinetti): over 3 seconds = elevated fall risk.
 *    Detected by watching hip Y velocity: fast rising hip = standing up.
 *
 * 5. POST-STAND WOBBLE  (Transition mode)
 *    How much does the CoG sway in the 5 seconds immediately after standing?
 *    This window is when most real-world falls happen — the transition
 *    from sitting to standing destabilises the balance system temporarily.
 *
 * 6. NUDGE RECOVERY RATIO  (Standing mode)
 *    When the person leans forward and recovers, how much sideways movement
 *    happens vs. forward-backward movement?
 *    A high ratio = the nervous system is not controlling balance well.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * COORDINATE SYSTEM
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * All landmark x, y values are normalised fractions (0–1) in screen space:
 *   x: 0 = left edge, 1 = right edge
 *   y: 0 = top of screen, 1 = bottom of screen
 *
 * This means:
 *   - When someone stands up, their hip Y DECREASES (moves toward the top)
 *   - When walking, the planted foot has a HIGHER y-value than the lifted foot
 *   - Lateral movement shows as changes in x-values
 */

import { PoseFrame, SessionMode } from '../types';
import { LM } from './landmarks';
import { RollingBuffer } from './RollingBuffer';

// ─────────────────────────────────────────────────────────────────────────────
// MATH UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/** Average (mean) of a number array. Returns 0 for empty arrays. */
function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/** Statistical variance: average of squared deviations from the mean. */
function variance(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length;
}

/** Clamp a value into a [min, max] range. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ─────────────────────────────────────────────────────────────────────────────
// OUTPUT TYPE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * RawMeasurements — THE OUTPUT OF ALL SIX DETECTORS
 *
 * Each field is a score from 0 to 100 where HIGHER = SAFER.
 * These are fed into scoreAggregator.ts to produce the five dashboard scores.
 *
 * Default is 50 (neutral / insufficient data) for all fields.
 */
export interface RawMeasurements {
  standingStability:  number;  // 0-100, Standing mode
  lateralTrunkSway:   number;  // 0-100, Walking mode
  stepRhythm:         number;  // 0-100, Walking mode
  standupDuration:    number;  // 0-100, Transition mode
  postStandWobble:    number;  // 0-100, Transition mode
  nudgeRecovery:      number;  // 0-100, Standing mode
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN DETECTOR CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PoseDetectors — STATEFUL ENGINE THAT ACCUMULATES MEASUREMENTS OVER TIME
 *
 * This class is instantiated ONCE when the session starts (using React's useRef
 * so it survives re-renders) and then receives every pose frame via update().
 *
 * It maintains all the rolling buffers and state machines internally.
 * The caller just calls update() and reads the measurements property.
 */
export class PoseDetectors {

  // ── Current measurement values (updated each frame) ──────────────────────
  measurements: RawMeasurements = {
    standingStability: 50,
    lateralTrunkSway:  50,
    stepRhythm:        50,
    standupDuration:   50,
    postStandWobble:   50,
    nudgeRecovery:     50,
  };

  // ── ROLLING BUFFERS ───────────────────────────────────────────────────────

  /**
   * Centre-of-gravity buffer (5 seconds).
   * CoG = midpoint of left hip and right hip.
   * Used by: StandingStability, LateralTrunkSway, NudgeRecovery, PostStandWobble.
   */
  private cogBuf = new RollingBuffer<{ x: number; y: number }>(5000);

  /**
   * Ankle differential buffer (10 seconds).
   * Stores (leftAnkle.y - rightAnkle.y) each frame.
   * When left foot is planted and right is lifted: positive value.
   * When right foot is planted and left is lifted: negative value.
   * Zero-crossings of this signal mark step transitions.
   * Used by: StepRhythm.
   */
  private ankleDiffBuf = new RollingBuffer<number>(10000);

  /**
   * Hip Y buffer (3 seconds, fast refresh).
   * Used for standup detection — we watch for a rapid upward hip movement.
   */
  private hipYBuf = new RollingBuffer<number>(3000);

  // ── STEP RHYTHM STATE ─────────────────────────────────────────────────────

  /**
   * The last measured sign of the ankle differential (+1 or -1).
   * A sign change = zero crossing = step event.
   */
  private prevAnkleDiffSign = 0;

  /**
   * Timestamp (ms) of the last zero-crossing detected.
   * We subtract consecutive timestamps to get step intervals.
   */
  private lastZeroCrossing = 0;

  /**
   * Collected step intervals (ms between consecutive zero-crossings).
   * We keep up to 20 intervals — enough for reliable CV calculation.
   * CV (coefficient of variation) = stdDev / mean.
   * A low CV means all steps took about the same time (regular gait).
   */
  private stepIntervals: number[] = [];

  // ── STAND-UP STATE MACHINE ────────────────────────────────────────────────

  /**
   * Which phase of the sit-to-stand movement are we in?
   *
   *   idle         → person is standing or sitting, not transitioning
   *   rising       → hips are moving upward (transition detected, timer running)
   *   post-stand   → person just finished standing, measuring wobble for 5 seconds
   */
  private standupPhase: 'idle' | 'rising' | 'post-stand' = 'idle';

  /**
   * When (ms) the rising phase started.
   * Used to compute stand-up duration.
   */
  private standupStartMs = 0;

  /**
   * When (ms) the person became fully upright (hip velocity returned to ~0).
   * Used to know when to start the 5-second post-stand wobble window.
   */
  private standupEndMs = 0;

  /**
   * The last recorded stand-up duration in seconds.
   * Null means no stand-up has been observed yet this session.
   */
  private lastStandupDurationSec: number | null = null;

  /**
   * Buffer for CoG positions during the post-stand wobble window.
   * We use a fresh 5-second buffer (not the shared cogBuf) so the
   * pre-standup data doesn't contaminate the wobble measurement.
   */
  private postStandBuf = new RollingBuffer<{ x: number; y: number }>(5000);

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * update() — PROCESS ONE POSE FRAME
   *
   * Call this every time MediaPipe delivers a new frame.
   * It updates whichever detectors are relevant for the current mode.
   * After this call, read `this.measurements` for the latest values.
   *
   * @param pose  33-landmark PoseFrame from MediaPipe
   * @param mode  Which movement the user is performing right now
   */
  update(pose: PoseFrame, mode: SessionMode): void {
    const leftHip   = pose[LM.LEFT_HIP];
    const rightHip  = pose[LM.RIGHT_HIP];
    const leftAnkle = pose[LM.LEFT_ANKLE];
    const rightAnkle= pose[LM.RIGHT_ANKLE];

    // If the core landmarks aren't visible, skip this frame.
    // Low visibility means MediaPipe isn't confident the joint is in frame.
    if (!leftHip || !rightHip) return;
    if ((leftHip.visibility  ?? 1) < 0.4) return;
    if ((rightHip.visibility ?? 1) < 0.4) return;

    // ── Compute centre of gravity (CoG) ──────────────────────────────────
    // CoG is the midpoint between the two hips.
    // This is the best single-landmark proxy for the body's balance point
    // that MediaPipe Pose gives us. True CoG includes the full body mass
    // distribution, but the hip midpoint is a clinically accepted proxy.
    const cogX = (leftHip.x + rightHip.x) / 2;
    const cogY = (leftHip.y + rightHip.y) / 2;

    this.cogBuf.push({ x: cogX, y: cogY });
    this.hipYBuf.push(cogY);

    // ── Run mode-specific detectors ──────────────────────────────────────
    if (mode === 'standing') {
      this.updateStandingStability();
      this.updateNudgeRecovery();
    }

    if (mode === 'walking') {
      if (leftAnkle && rightAnkle &&
          (leftAnkle.visibility  ?? 1) > 0.4 &&
          (rightAnkle.visibility ?? 1) > 0.4) {
        this.updateAnkleDiff(leftAnkle.y, rightAnkle.y);
        this.updateStepRhythm();
      }
      this.updateLateralTrunkSway();
    }

    if (mode === 'transition') {
      this.updateStandupStateMachine(cogY);
      this.updatePostStandWobble(cogX, cogY);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DETECTOR 1 — STANDING STABILITY
  // ─────────────────────────────────────────────────────────────────────────

  private updateStandingStability(): void {
    const pts = this.cogBuf.values();

    // Need at least 30 frames (~1 second) before the measurement is meaningful.
    if (pts.length < 30) return;

    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);

    /**
     * Variance measures how spread out the values are around their mean.
     * High variance = large sway = risky.
     * Near-zero variance = abnormally rigid = also a warning sign (could
     * indicate a person who is "frozen" with fear of falling, or
     * a measurement artefact when the camera is the one moving).
     *
     * The total variance combines both lateral (X) and vertical (Y) movement.
     * In screen-fraction units, a variance of 0.00001 ≈ 1mm of sway at 2m camera
     * distance. Healthy standing = 0.00005–0.0005. Risky = > 0.001.
     */
    const totalVar = variance(xs) + variance(ys);

    let score: number;
    if (totalVar < 0.000005) {
      // Virtually no movement at all — could be abnormally rigid.
      // Give a moderate score rather than full marks.
      score = 65;
    } else if (totalVar <= 0.0003) {
      // Healthy micro-sway zone. Score 75–100 linearly.
      score = 75 + 25 * (1 - totalVar / 0.0003);
    } else if (totalVar <= 0.001) {
      // Moderate sway — borderline. Score 50–75.
      score = 75 - ((totalVar - 0.0003) / 0.0007) * 25;
    } else {
      // Excessive sway — high risk. Score drops toward 0.
      score = Math.max(0, 50 - ((totalVar - 0.001) / 0.002) * 50);
    }

    this.measurements.standingStability = clamp(score, 0, 100);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DETECTOR 2 — LATERAL TRUNK SWAY
  // ─────────────────────────────────────────────────────────────────────────

  private updateLateralTrunkSway(): void {
    const pts = this.cogBuf.values();
    if (pts.length < 20) return;

    const xs = pts.map(p => p.x);

    /**
     * Range = max - min of hip X position over the window.
     * This tells us how far the hips swung side-to-side in total.
     *
     * In screen-fraction units (0–1 across the full screen width):
     *   Range 0.00–0.04 = very minimal sway (may indicate shuffling gait)
     *   Range 0.04–0.10 = normal healthy walking sway
     *   Range 0.10–0.20 = elevated sway (hip weakness or compensation)
     *   Range > 0.20    = severe sway — strong fall risk indicator
     *
     * We score on a curve: small amounts of sway in the healthy zone
     * score near 100. As range climbs above 0.10, score drops quickly.
     */
    const range = Math.max(...xs) - Math.min(...xs);

    let score: number;
    if (range <= 0.04) {
      // Very small lateral movement. Could be shuffling. Neutral-ish score.
      score = 70;
    } else if (range <= 0.10) {
      // Healthy sway zone. Full 100 at range = 0.07, tapering slightly at edges.
      score = 100 - Math.abs(range - 0.07) / 0.07 * 20;
    } else if (range <= 0.18) {
      // Elevated sway. Linear drop from 80 → 40 as range goes 0.10 → 0.18.
      score = 80 - ((range - 0.10) / 0.08) * 40;
    } else {
      // Severe sway. Continue dropping toward 0.
      score = Math.max(0, 40 - ((range - 0.18) / 0.10) * 40);
    }

    this.measurements.lateralTrunkSway = clamp(score, 0, 100);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DETECTOR 3 — STEP RHYTHM CONSISTENCY
  // ─────────────────────────────────────────────────────────────────────────

  private updateAnkleDiff(leftAnkleY: number, rightAnkleY: number): void {
    /**
     * The ankle differential is a clever signal for detecting steps without
     * needing to know the absolute position of the person.
     *
     * When you walk:
     *   - The planted foot stays near the ground (HIGH y-value, near bottom)
     *   - The lifted foot rises up (LOWER y-value, toward top)
     *
     * So (leftAnkle.y - rightAnkle.y):
     *   - Positive → left foot lower (planted), right foot higher (lifted)
     *   - Negative → right foot lower (planted), left foot higher (lifted)
     *   - Zero crossing → the transition moment between steps
     *
     * The interval between consecutive zero-crossings = time between steps.
     * Regular intervals = regular gait. Irregular = fall risk.
     */
    this.ankleDiffBuf.push(leftAnkleY - rightAnkleY);
  }

  private updateStepRhythm(): void {
    const diffs = this.ankleDiffBuf.values();
    const times = this.ankleDiffBuf.timestamps();

    if (diffs.length < 10) return;

    // Detect zero crossings by checking for sign changes between consecutive samples
    const latest    = diffs[diffs.length - 1];
    const latestT   = times[times.length - 1];
    const latestSign = latest > 0.01 ? 1 : latest < -0.01 ? -1 : 0; // ±0.01 deadband prevents noise triggers

    if (latestSign !== 0 && latestSign !== this.prevAnkleDiffSign) {
      // Sign changed — a step transition just happened
      if (this.prevAnkleDiffSign !== 0 && this.lastZeroCrossing > 0) {
        const interval = latestT - this.lastZeroCrossing;

        // Sanity check: ignore intervals shorter than 200ms (< 5 steps/sec, physiologically impossible)
        // or longer than 3000ms (> 3 seconds per step, means person stopped)
        if (interval > 200 && interval < 3000) {
          this.stepIntervals.push(interval);
          // Keep only the most recent 20 intervals (covers ~10 full gait cycles)
          if (this.stepIntervals.length > 20) this.stepIntervals.shift();
        }
      }
      this.lastZeroCrossing = latestT;
    }

    this.prevAnkleDiffSign = latestSign;

    // Need at least 4 intervals (= 2 full gait cycles) to calculate CV meaningfully
    if (this.stepIntervals.length < 4) return;

    const m  = mean(this.stepIntervals);
    const sd = Math.sqrt(variance(this.stepIntervals));

    /**
     * CV (Coefficient of Variation) = stdDev / mean
     *
     * CV = 0.0  → perfectly regular (every step takes exactly the same time)
     * CV = 0.10 → 10% variation — healthy walking, barely noticeable
     * CV = 0.25 → 25% variation — noticeably uneven gait
     * CV = 0.50 → 50% variation — very irregular, high fall risk
     *
     * Rivolta 2019: step rhythm CV had r = 0.65 correlation with Tinetti score —
     * the single strongest predictor of fall risk in the study.
     *
     * Score = 100 × (1 − CV/0.5), clamped to [0, 100]
     */
    const cv    = m > 0 ? sd / m : 0;
    const score = 100 * (1 - cv / 0.5);

    this.measurements.stepRhythm = clamp(score, 0, 100);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DETECTORS 4 & 5 — STAND-UP DURATION + POST-STAND WOBBLE
  // ─────────────────────────────────────────────────────────────────────────

  private updateStandupStateMachine(cogY: number): void {
    const hipYs = this.hipYBuf.values();
    if (hipYs.length < 10) return;

    const now = Date.now();

    if (this.standupPhase === 'idle') {
      /**
       * IDLE → RISING transition:
       * We're looking for a sustained upward movement of the hips.
       *
       * In screen space, "moving up" = Y value DECREASING.
       * Compare the most recent 5 frames to 10 frames ago.
       * If hip Y dropped by > 0.025 (2.5% of screen height), a standup may be starting.
       *
       * This threshold is small enough to catch slow careful stands but large enough
       * to ignore normal standing-sway (which is < 0.01).
       */
      const recent = hipYs.slice(-5);
      const older  = hipYs.slice(-15, -10);
      if (older.length < 5) return;

      const recentMean = mean(recent);
      const olderMean  = mean(older);

      if (olderMean - recentMean > 0.025) {
        // Hip is moving upward — standup detected!
        this.standupPhase    = 'rising';
        this.standupStartMs  = now;
      }

    } else if (this.standupPhase === 'rising') {
      /**
       * RISING → IDLE/POST-STAND transition:
       * We're watching for when the upward hip movement STOPS (person is now upright).
       *
       * "Stopped" = hip Y velocity is near zero — compute this by comparing
       * the average of the last 5 frames to 5 frames before that.
       */
      const recent = hipYs.slice(-5);
      const before = hipYs.slice(-10, -5);
      if (before.length < 5) return;

      const velocity = Math.abs(mean(recent) - mean(before));

      // Timeout: if rising has been going on for > 8 seconds, something is wrong — reset
      if (now - this.standupStartMs > 8000) {
        this.standupPhase = 'idle';
        return;
      }

      if (velocity < 0.005) {
        // Hip has stopped moving — person is now upright.
        const durationSec = (now - this.standupStartMs) / 1000;
        this.standupEndMs = now;
        this.lastStandupDurationSec = durationSec;

        /**
         * SCORING STAND-UP DURATION:
         *
         * From the Tinetti scale (gold standard clinical assessment):
         *   < 1.5 seconds = excellent, full score
         *   1.5–3 seconds = normal range, slight concern starts at 2s
         *   > 3 seconds    = clinically elevated fall risk
         *   > 5 seconds    = high fall risk
         *
         * We score linearly within these zones.
         */
        let score: number;
        if (durationSec < 1.5) {
          score = 100;
        } else if (durationSec < 3.0) {
          score = 100 - ((durationSec - 1.5) / 1.5) * 40;  // 100 → 60
        } else if (durationSec < 5.0) {
          score = 60 - ((durationSec - 3.0) / 2.0) * 40;   // 60 → 20
        } else {
          score = Math.max(0, 20 - (durationSec - 5.0) * 5);
        }

        this.measurements.standupDuration = clamp(score, 0, 100);
        this.standupPhase = 'post-stand';
        this.postStandBuf.clear();
      }

    } else if (this.standupPhase === 'post-stand') {
      /**
       * POST-STAND phase: collect CoG data for 5 seconds.
       * After 5 seconds, return to IDLE.
       * (The actual wobble score is computed in updatePostStandWobble.)
       */
      if (now - this.standupEndMs > 5000) {
        this.standupPhase = 'idle';
      }
    }
  }

  private updatePostStandWobble(cogX: number, cogY: number): void {
    if (this.standupPhase === 'post-stand') {
      // Feed CoG into the post-stand buffer while we're in the measurement window
      this.postStandBuf.push({ x: cogX, y: cogY });
    }

    const pts = this.postStandBuf.values();
    if (pts.length < 10) return;

    /**
     * Post-stand wobble = CoG variance in the 5 seconds after standing.
     * This is clinically significant because the transition from sitting to standing
     * temporarily destabilises the balance system — it's the most common moment for falls.
     *
     * Scoring is similar to StandingStability but with a tighter threshold,
     * because post-standup sway is inherently higher-risk than resting sway.
     */
    const totalVar = variance(pts.map(p => p.x)) + variance(pts.map(p => p.y));

    let score: number;
    if (totalVar < 0.0001) {
      score = 90;  // Very stable — good recovery
    } else if (totalVar <= 0.0005) {
      score = 90 - ((totalVar - 0.0001) / 0.0004) * 20;  // 90 → 70
    } else if (totalVar <= 0.002) {
      score = 70 - ((totalVar - 0.0005) / 0.0015) * 40;  // 70 → 30
    } else {
      score = Math.max(0, 30 - ((totalVar - 0.002) / 0.003) * 30);
    }

    this.measurements.postStandWobble = clamp(score, 0, 100);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DETECTOR 6 — NUDGE RECOVERY RATIO
  // ─────────────────────────────────────────────────────────────────────────

  private updateNudgeRecovery(): void {
    const pts = this.cogBuf.values();
    if (pts.length < 20) return;

    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);

    const rangeX = Math.max(...xs) - Math.min(...xs);  // lateral (side-to-side)
    const rangeY = Math.max(...ys) - Math.min(...ys);  // sagittal (forward-back)

    /**
     * The nudge recovery ratio compares how much the body sways sideways
     * vs. forward-backward during any lean event.
     *
     * A well-functioning balance system primarily sways forward-backward
     * when recovering from a nudge (the "ankle strategy"). Excessive sideways
     * movement indicates the "hip strategy" is dominant, which uses larger
     * muscle groups and is less efficient — a sign of poor neuromuscular control.
     *
     * Ratio = lateral range / sagittal range
     *   ratio < 0.5 → mostly forward-back movement (excellent balance strategy)
     *   ratio ~1.0  → equal in both directions (adequate)
     *   ratio > 1.5 → mostly sideways (poor recovery, fall risk)
     *
     * If there's virtually no sagittal movement, the person isn't leaning
     * at all — return a neutral score rather than a misleadingly high score.
     */
    if (rangeY < 0.008) {
      // Not enough sagittal movement to compute a meaningful ratio
      this.measurements.nudgeRecovery = 65;
      return;
    }

    const ratio = rangeX / rangeY;
    let score: number;
    if (ratio < 0.5) {
      score = 95;  // Excellent — mostly forward-back movement
    } else if (ratio <= 1.0) {
      score = 95 - ((ratio - 0.5) / 0.5) * 25;   // 95 → 70
    } else if (ratio <= 1.5) {
      score = 70 - ((ratio - 1.0) / 0.5) * 35;   // 70 → 35
    } else {
      score = Math.max(0, 35 - ((ratio - 1.5) / 1.0) * 35);
    }

    this.measurements.nudgeRecovery = clamp(score, 0, 100);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UTILITIES
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * reset() — Clear all buffers and state when the user switches mode.
   * Called from SessionScreen when mode changes so stale data from one
   * movement type doesn't bleed into another.
   */
  reset(): void {
    this.cogBuf.clear();
    this.ankleDiffBuf.clear();
    this.hipYBuf.clear();
    this.postStandBuf.clear();
    this.stepIntervals     = [];
    this.prevAnkleDiffSign = 0;
    this.lastZeroCrossing  = 0;
    this.standupPhase      = 'idle';
    this.standupStartMs    = 0;
    this.standupEndMs      = 0;
  }
}
