/**
 * src/engine/exercise/__tests__/pipeline.test.ts — MINIMAL SMOKE TESTS
 *
 * Synthetic squat data: a person standing → squatting → standing repeatedly.
 * Verifies the full pipeline detects the right number of reps and produces
 * sane RepFeatures + a valid CSV.
 *
 * No React Native imports — runnable with plain `npx jest`.
 */

import { LM } from '../../landmarks';
import { Landmark, PoseFrame } from '../../../types';
import { ExercisePipeline } from '../pipeline';
import { normalizeLandmarks } from '../normalize';
import { computeFrameFeatures } from '../frameFeatures';
import { updateRepState } from '../repDetector';
import { computeErrors, computeScore } from '../errors';
import { buildRepsCsv } from '../csvWriter';
import { RepFeatureValues } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic squat frame generator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * makeSquatFrame — produces a believable PoseFrame for a person whose knee
 * is at `flexion` degrees of bend, optionally with a valgus offset on the
 * left knee (positive = knee drifts toward midline).
 *
 * The generator chooses hip / knee / ankle positions so that
 * computeFrameFeatures recovers approximately the requested flexion.
 *
 * Geometry sketch (screen-y grows downward):
 *
 *   hip   at  y = 0.55
 *   ankle at  y = 0.90  (fixed)
 *   knee  at  y between hip and ankle, with x that produces the requested
 *             inner angle hip-knee-ankle.
 *
 * For a given flexion f, we want angle(hip, knee, ankle) = 180 - f.
 * Place hip at (xh, yh) and ankle at (xh, ya) (vertical column for a
 * single side). Knee at (xh + r*cos(theta), (yh+ya)/2) where theta is
 * derived such that the inner angle is what we want. To keep this simple
 * and robust we instead solve numerically by binary-searching the knee x
 * offset.
 */
function makeFrame(
  flexion: number,
  options: {
    /**
     * MAX valgus offset to add to the LEFT knee x toward midline. Scales
     * linearly with current flexion (proportion = flexion / 90), so a
     * standing pose has 0 offset and a deep squat has the full offset.
     * That mirrors real knee valgus, which only manifests under load.
     */
    valgusOffset?: number;
    trunkLeanX?: number;       // adds to shoulder x for lateral lean
    trunkFlexZ?: number;       // adds to shoulder z for forward lean
    midHipDriftX?: number;     // adds to both hip x (lateral shift over time)
  } = {},
): PoseFrame {
  const yHip = 0.55;
  const yAnkle = 0.90;
  // For a 1-leg planar model, knee y is interpolated between hip and ankle.
  // The flexion angle is recovered from the hip-knee-ankle inner angle.
  // Place hip and ankle at the SAME x (column) and pick knee x so the
  // inner angle is (180 - flexion).
  const targetInner = 180 - flexion;

  const findKneeX = (xCol: number): { kx: number; ky: number } => {
    // Knee y midway. Solve for kx via binary search.
    const ky = (yHip + yAnkle) / 2;
    const innerAt = (kx: number): number => {
      const a = { x: xCol - kx, y: yHip - ky };  // hip - knee
      const b = { x: xCol - kx, y: yAnkle - ky }; // ankle - knee
      const cos = (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y));
      return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
    };
    // Search kx in [xCol, xCol + 0.4] (forward of the column → smaller inner).
    let lo = xCol;
    let hi = xCol + 0.4;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      const inner = innerAt(mid);
      if (inner > targetInner) lo = mid; else hi = mid;
    }
    return { kx: (lo + hi) / 2, ky };
  };

  const lm = (x: number, y: number, z = 0, v = 0.95): Landmark => ({ x, y, z, visibility: v });

  // Pelvis: 0.44 (left), 0.56 (right). Shift if requested.
  const lhX = 0.44 + (options.midHipDriftX ?? 0);
  const rhX = 0.56 + (options.midHipDriftX ?? 0);
  const midX = (lhX + rhX) / 2;

  // Each leg uses its own column.
  const lk = findKneeX(lhX);
  const rk = findKneeX(rhX);

  // Apply valgus offset on the LEFT knee toward midline (right-ward),
  // scaled by current flexion so standing has 0 offset.
  const valgusScale = Math.max(0, Math.min(1, flexion / 90));
  const lkx = lk.kx + (options.valgusOffset ?? 0) * valgusScale;

  const frame: Landmark[] = Array(33).fill(null).map(() => lm(0.5, 0.5, 0, 0.4));

  frame[LM.NOSE]           = lm(midX,                0.10);
  frame[LM.LEFT_EAR]       = lm(midX - 0.04,         0.09);
  frame[LM.RIGHT_EAR]      = lm(midX + 0.04,         0.09);

  frame[LM.LEFT_SHOULDER]  = lm(midX - 0.09 + (options.trunkLeanX ?? 0), 0.22, options.trunkFlexZ ?? 0);
  frame[LM.RIGHT_SHOULDER] = lm(midX + 0.09 + (options.trunkLeanX ?? 0), 0.22, options.trunkFlexZ ?? 0);

  frame[LM.LEFT_HIP]       = lm(lhX, yHip);
  frame[LM.RIGHT_HIP]      = lm(rhX, yHip);

  frame[LM.LEFT_KNEE]      = lm(lkx,    lk.ky);
  frame[LM.RIGHT_KNEE]     = lm(rk.kx,  rk.ky);

  frame[LM.LEFT_ANKLE]     = lm(lhX, yAnkle);
  frame[LM.RIGHT_ANKLE]    = lm(rhX, yAnkle);

  frame[LM.LEFT_HEEL]      = lm(lhX - 0.01, yAnkle + 0.02);
  frame[LM.RIGHT_HEEL]     = lm(rhX + 0.01, yAnkle + 0.02);

  // Foot index (toes)
  frame[31]                = lm(lhX + 0.04, yAnkle + 0.02);
  frame[32]                = lm(rhX - 0.04, yAnkle + 0.02);

  return frame;
}

/** Sweep: standing → bottom (peakDeg) → standing, in `nFrames` total. */
function makeSquatRep(
  startMs: number,
  fps: number,
  peakDeg: number,
  nFrames: number,
  options?: Parameters<typeof makeFrame>[1],
): { t: number; pose: PoseFrame }[] {
  const out: { t: number; pose: PoseFrame }[] = [];
  const dtMs = 1000 / fps;
  for (let i = 0; i < nFrames; i++) {
    // Cosine ease: 0 → 1 → 0
    const phase = (i / (nFrames - 1)) * Math.PI;
    const k = peakDeg * (1 - Math.cos(phase)) / 2 * 2; // 0..peak..0 via 1-cos and back
    // Simpler: triangle wave from 0..peak..0.
    const tri = i < nFrames / 2
      ? (i / (nFrames / 2)) * peakDeg
      : (1 - (i - nFrames / 2) / (nFrames / 2)) * peakDeg;
    const flex = Math.max(0, tri);
    out.push({ t: startMs + i * dtMs, pose: makeFrame(flex, options) });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('exercise pipeline', () => {

  test('normalizeLandmarks: hip mid → (0,0), pelvis spans 1 unit', () => {
    const f = makeFrame(0);
    const n = normalizeLandmarks(f);
    const lh = n[LM.LEFT_HIP];
    const rh = n[LM.RIGHT_HIP];
    // After normalising, hips are symmetric around 0 along x and pelvis
    // width on x is exactly 1.
    expect(Math.abs(lh.x + rh.x)).toBeLessThan(1e-6);
    expect(Math.abs(rh.x - lh.x - 1)).toBeLessThan(1e-6);
    // Hip y should be 0 too.
    expect(Math.abs((lh.y + rh.y) / 2)).toBeLessThan(1e-6);
  });

  test('computeFrameFeatures: standing → low knee flex, low FPPA', () => {
    const f = makeFrame(0);
    const norm = normalizeLandmarks(f);
    const ff = computeFrameFeatures(0, f, norm);
    expect(ff.kneeFlexion).toBeLessThan(5);
    expect(ff.fppa).toBeLessThan(5);
    expect(ff.trunkLean).toBeLessThan(2);
  });

  test('computeFrameFeatures: deep squat → high knee flex', () => {
    const f = makeFrame(80);
    const norm = normalizeLandmarks(f);
    const ff = computeFrameFeatures(0, f, norm);
    expect(ff.kneeFlexion).toBeGreaterThan(60);
  });

  test('updateRepState: synthetic single rep produces start, bottom, end events', () => {
    const frames = makeSquatRep(0, 30, 90, 60);
    const pipe = new ExercisePipeline('squat');
    let observedStarts = 0, observedBottoms = 0, observedEnds = 0;

    // Drive frames one by one, also peek at events using the same building blocks.
    let prevFF: ReturnType<typeof computeFrameFeatures> | undefined;
    let state: 'IDLE' | 'DESCENT' | 'ASCENT' = 'IDLE';
    for (const { t, pose } of frames) {
      const norm = normalizeLandmarks(pose);
      const ff = computeFrameFeatures(t, pose, norm, prevFF);
      const r = updateRepState(ff, prevFF, state);
      if (r.events.repStart) observedStarts++;
      if (r.events.bottom)   observedBottoms++;
      if (r.events.repEnd)   observedEnds++;
      prevFF = ff;
      state = r.state;

      pipe.onFrame(t, pose);
    }

    expect(observedStarts).toBe(1);
    expect(observedBottoms).toBe(1);
    expect(observedEnds).toBe(1);

    const session = pipe.finalize();
    expect(session.reps.length).toBe(1);
    const rep = session.reps[0];
    // Squat reached at least the trigger depth.
    expect(rep.features.kneeFlexionDeg).toBeGreaterThan(60);
    expect(rep.features.romRatio).toBeGreaterThan(0.5);
    expect(rep.timing.durationMs).toBeGreaterThan(500);
    // Default synthetic squat is clean → minimal errors, classified at least "fair".
    expect(['good', 'fair']).toContain(rep.score.classification);
  });

  test('three reps in sequence are all detected', () => {
    const fps = 30;
    const repFrames = 60; // 2s per rep
    const allFrames = [
      ...makeSquatRep(0,                30, 90, repFrames),
      ...makeSquatRep(repFrames * 1000 / fps,         30, 85, repFrames),
      ...makeSquatRep(repFrames * 2 * 1000 / fps,     30, 95, repFrames),
    ];
    const pipe = new ExercisePipeline('squat');
    for (const { t, pose } of allFrames) pipe.onFrame(t, pose);
    const session = pipe.finalize();
    expect(session.reps.length).toBe(3);
    expect(session.summary.numReps).toBe(3);
    expect(session.summary.avgDepth).toBeGreaterThan(60);
  });

  test('rep with valgus collapse triggers kneeValgus error', () => {
    // Add a clear valgus offset (knee drift toward midline).
    const frames = makeSquatRep(0, 30, 90, 60, { valgusOffset: 0.05 });
    const pipe = new ExercisePipeline('squat');
    for (const { t, pose } of frames) pipe.onFrame(t, pose);
    const reps = pipe.getReps();
    expect(reps.length).toBe(1);
    expect(reps[0].errors.kneeValgus).toBe(true);
  });

  test('shallow rep below MIN_REP_DEPTH_DEG is filtered out', () => {
    // Peak knee flexion 30° (below the 45° minimum). Should produce 0 reps.
    const frames = makeSquatRep(0, 30, 30, 60);
    const pipe = new ExercisePipeline('squat');
    for (const { t, pose } of frames) pipe.onFrame(t, pose);
    expect(pipe.getReps().length).toBe(0);
  });

  test('computeErrors / computeScore: counts thresholded errors', () => {
    const features: RepFeatureValues = {
      kneeFlexionDeg:   90,
      romRatio:         0.75,
      fppaPeak:         12,    // > 8 → kneeValgus
      fppaAtDepth:      11,
      trunkLeanPeak:    15,    // > 10 → trunkLean
      trunkFlexPeak:    20,
      pelvicDropPeak:    2,
      pelvicShiftPeak:   0.05,
      hipAdductionPeak:  3,
      kneeOffsetPeak:    0.10,
      swayNorm:          0.02,
      smoothness:        2.0,
    };
    const e = computeErrors(features);
    const s = computeScore(e);
    expect(e.kneeValgus).toBe(true);
    expect(e.trunkLean).toBe(true);
    expect(e.balance).toBe(false);
    expect(s.totalErrors).toBe(2);
    expect(s.classification).toBe('fair');
  });

  test('buildRepsCsv produces a header + one row per rep', () => {
    const frames = makeSquatRep(0, 30, 90, 60);
    const pipe = new ExercisePipeline('squat');
    for (const { t, pose } of frames) pipe.onFrame(t, pose);
    const csv = buildRepsCsv(pipe.getReps());
    const lines = csv.trim().split('\n');
    expect(lines.length).toBe(2); // header + 1 rep
    expect(lines[0]).toContain('rep_id');
    expect(lines[0]).toContain('classification');
    expect(lines[1].split(',').length).toBe(lines[0].split(',').length);
  });

});
