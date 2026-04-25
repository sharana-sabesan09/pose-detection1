/**
 * src/engine/exercise/__tests__/pipeline.test.ts
 *
 * Synthetic squat data drives the full post-hoc pipeline.
 * makeFrame() moves hips downward proportionally to knee flexion so the
 * hip-Y detector has a real signal to work with.
 */

import { LM }                         from '../../landmarks';
import { Landmark, PoseFrame }         from '../../../types';
import { ExercisePipeline }            from '../pipeline';
import { normalizeLandmarks }          from '../normalize';
import { computeFrameFeatures }        from '../frameFeatures';
import { detectRepRanges }             from '../repDetector';
import { computeErrors, computeScore } from '../errors';
import { buildRepsCsv }                from '../csvWriter';
import { RepFeatureValues }            from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic frame generator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * makeFrame — PoseFrame at `flexion` degrees of knee bend.
 * Hips descend proportionally: standing (0°) → yHip 0.55, deep squat (120°) → 0.67.
 * Ankles stay fixed at 0.90 (feet on the floor).
 */
function makeFrame(
  flexion: number,
  options: {
    valgusOffset?: number;
    trunkLeanX?:   number;
    trunkFlexZ?:   number;
    midHipDriftX?: number;
  } = {},
): PoseFrame {
  const yAnkle = 0.90;
  const yHip   = 0.55 + (flexion / 120) * 0.12;

  const targetInner = 180 - flexion;
  const findKneeX = (xCol: number) => {
    const ky = (yHip + yAnkle) / 2;
    const innerAt = (kx: number) => {
      const a = { x: xCol - kx, y: yHip - ky };
      const b = { x: xCol - kx, y: yAnkle - ky };
      const cos = (a.x * b.x + a.y * b.y) /
        (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y));
      return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
    };
    let lo = xCol, hi = xCol + 0.4;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      innerAt(mid) > targetInner ? (lo = mid) : (hi = mid);
    }
    return { kx: (lo + hi) / 2, ky };
  };

  const lm = (x: number, y: number, z = 0, v = 0.95): Landmark =>
    ({ x, y, z, visibility: v });

  const lhX  = 0.44 + (options.midHipDriftX ?? 0);
  const rhX  = 0.56 + (options.midHipDriftX ?? 0);
  const midX = (lhX + rhX) / 2;
  const lk   = findKneeX(lhX);
  const rk   = findKneeX(rhX);
  const valgusScale = Math.max(0, Math.min(1, flexion / 90));
  const lkx  = lk.kx + (options.valgusOffset ?? 0) * valgusScale;

  const frame: Landmark[] = Array(33).fill(null).map(() => lm(0.5, 0.5, 0, 0.4));
  frame[LM.NOSE]           = lm(midX,           0.10);
  frame[LM.LEFT_EAR]       = lm(midX - 0.04,    0.09);
  frame[LM.RIGHT_EAR]      = lm(midX + 0.04,    0.09);
  frame[LM.LEFT_SHOULDER]  = lm(midX - 0.09 + (options.trunkLeanX ?? 0), 0.22, options.trunkFlexZ ?? 0);
  frame[LM.RIGHT_SHOULDER] = lm(midX + 0.09 + (options.trunkLeanX ?? 0), 0.22, options.trunkFlexZ ?? 0);
  frame[LM.LEFT_HIP]       = lm(lhX,   yHip);
  frame[LM.RIGHT_HIP]      = lm(rhX,   yHip);
  frame[LM.LEFT_KNEE]      = lm(lkx,   lk.ky);
  frame[LM.RIGHT_KNEE]     = lm(rk.kx, rk.ky);
  frame[LM.LEFT_ANKLE]     = lm(lhX,   yAnkle);
  frame[LM.RIGHT_ANKLE]    = lm(rhX,   yAnkle);
  frame[LM.LEFT_HEEL]      = lm(lhX - 0.01, yAnkle + 0.02);
  frame[LM.RIGHT_HEEL]     = lm(rhX + 0.01, yAnkle + 0.02);
  frame[31]                = lm(lhX + 0.04,  yAnkle + 0.02);
  frame[32]                = lm(rhX - 0.04,  yAnkle + 0.02);
  return frame;
}

function makeSquatRep(
  startMs: number, fps: number, peakDeg: number, nFrames: number,
  options?: Parameters<typeof makeFrame>[1],
): { t: number; pose: PoseFrame }[] {
  const dtMs = 1000 / fps;
  return Array.from({ length: nFrames }, (_, i) => {
    const tri = i < nFrames / 2
      ? (i / (nFrames / 2)) * peakDeg
      : (1 - (i - nFrames / 2) / (nFrames / 2)) * peakDeg;
    return { t: startMs + i * dtMs, pose: makeFrame(Math.max(0, tri), options) };
  });
}

function makeStanding(startMs: number, fps: number, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    t: startMs + i * (1000 / fps),
    pose: makeFrame(0),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('exercise pipeline', () => {

  test('normalizeLandmarks: hip mid → (0,0), pelvis spans 1 unit', () => {
    const n  = normalizeLandmarks(makeFrame(0));
    const lh = n[LM.LEFT_HIP], rh = n[LM.RIGHT_HIP];
    expect(Math.abs(lh.x + rh.x)).toBeLessThan(1e-6);
    expect(Math.abs(rh.x - lh.x - 1)).toBeLessThan(1e-6);
    expect(Math.abs((lh.y + rh.y) / 2)).toBeLessThan(1e-6);
  });

  test('computeFrameFeatures: standing → low knee flex + low FPPA', () => {
    const f  = makeFrame(0);
    const ff = computeFrameFeatures(0, f, normalizeLandmarks(f));
    expect(ff.kneeFlexion).toBeLessThan(5);
    expect(ff.fppa).toBeLessThan(5);
    expect(ff.trunkLean).toBeLessThan(2);
  });

  test('computeFrameFeatures: deep squat → high knee flex', () => {
    const f  = makeFrame(80);
    const ff = computeFrameFeatures(0, f, normalizeLandmarks(f));
    expect(ff.kneeFlexion).toBeGreaterThan(60);
  });

  test('detectRepRanges: single rep produces exactly one range', () => {
    const fps = 30, dtStand = 15 * (1000 / fps), dtRep = 60 * (1000 / fps);
    const frames = [
      ...makeStanding(0, fps, 15),
      ...makeSquatRep(dtStand, fps, 90, 60),
      ...makeStanding(dtStand + dtRep, fps, 15),
    ];
    const pipe = new ExercisePipeline('squat');
    for (const { t, pose } of frames) pipe.onFrame(t, pose);
    const ranges = detectRepRanges(pipe.getFrameBuffer());
    expect(ranges.length).toBe(1);
    expect(ranges[0].bottomIdx).toBeGreaterThan(ranges[0].startIdx);
    expect(ranges[0].endIdx).toBeGreaterThan(ranges[0].bottomIdx);
  });

  test('pipeline detects single rep via finalize()', () => {
    const fps = 30, dtStand = 15 * (1000 / fps), dtRep = 60 * (1000 / fps);
    const frames = [
      ...makeStanding(0, fps, 15),
      ...makeSquatRep(dtStand, fps, 90, 60),
      ...makeStanding(dtStand + dtRep, fps, 15),
    ];
    const pipe = new ExercisePipeline('squat');
    for (const { t, pose } of frames) pipe.onFrame(t, pose);
    const session = pipe.finalize();
    expect(session.reps.length).toBe(1);
    const rep = session.reps[0];
    expect(rep.repId).toBe(1);
    expect(rep.features.kneeFlexionDeg).toBeGreaterThan(60);
    expect(rep.timing.durationMs).toBeGreaterThan(500);
    expect(['good', 'fair']).toContain(rep.score.classification);
  });

  test('three reps in sequence are all detected with sequential IDs', () => {
    const fps = 30, nFrames = 60, dtRep = nFrames * (1000 / fps), dtGap = 15 * (1000 / fps);
    const t0 = dtGap;                              // prefix standing
    const t1 = t0 + dtRep + dtGap;
    const t2 = t1 + dtRep + dtGap;
    const allFrames = [
      ...makeStanding(0,   fps, 15),               // let baseline settle first
      ...makeSquatRep(t0,  fps, 90, nFrames),
      ...makeStanding(t0 + dtRep, fps, 15),
      ...makeSquatRep(t1,  fps, 85, nFrames),
      ...makeStanding(t1 + dtRep, fps, 15),
      ...makeSquatRep(t2,  fps, 95, nFrames),
      ...makeStanding(t2 + dtRep, fps, 15),
    ];
    const pipe = new ExercisePipeline('squat');
    for (const { t, pose } of allFrames) pipe.onFrame(t, pose);
    const session = pipe.finalize();
    expect(session.reps.length).toBe(3);
    expect(session.summary.numReps).toBe(3);
    expect(session.summary.avgDepth).toBeGreaterThan(60);
    expect(session.reps.map(r => r.repId)).toEqual([1, 2, 3]);
  });

  test('rep with valgus collapse triggers kneeValgus error', () => {
    const fps = 30, dtStand = 15 * (1000 / fps), dtRep = 60 * (1000 / fps);
    const frames = [
      ...makeStanding(0, fps, 15),
      ...makeSquatRep(dtStand, fps, 90, 60, { valgusOffset: 0.05 }),
      ...makeStanding(dtStand + dtRep, fps, 15),
    ];
    const pipe = new ExercisePipeline('squat');
    for (const { t, pose } of frames) pipe.onFrame(t, pose);
    const reps = pipe.finalize().reps;
    expect(reps.length).toBe(1);
    expect(reps[0].errors.kneeValgus).toBe(true);
  });

  test('shallow movement produces no reps', () => {
    const pipe = new ExercisePipeline('squat');
    for (const { t, pose } of makeSquatRep(0, 30, 15, 60)) pipe.onFrame(t, pose);
    expect(pipe.finalize().reps.length).toBe(0);
  });

  test('computeErrors / computeScore: counts thresholded errors', () => {
    const features: RepFeatureValues = {
      kneeFlexionDeg: 90, romRatio: 0.75,
      fppaPeak: 12, fppaAtDepth: 11,       // > 8  → kneeValgus
      trunkLeanPeak: 15, trunkFlexPeak: 20, // > 10 → trunkLean
      pelvicDropPeak: 2, pelvicShiftPeak: 0.05,
      hipAdductionPeak: 3, kneeOffsetPeak: 0.10,
      swayNorm: 0.02, smoothness: 2.0,
    };
    const e = computeErrors(features);
    const s = computeScore(e);
    expect(e.kneeValgus).toBe(true);
    expect(e.trunkLean).toBe(true);
    expect(e.balance).toBe(false);
    expect(s.totalErrors).toBe(2);
    expect(s.classification).toBe('fair');
  });

  test('buildRepsCsv: header + one row per rep', () => {
    const fps = 30, dtStand = 15 * (1000 / fps), dtRep = 60 * (1000 / fps);
    const pipe = new ExercisePipeline('squat');
    for (const { t, pose } of [
      ...makeStanding(0, fps, 15),
      ...makeSquatRep(dtStand, fps, 90, 60),
      ...makeStanding(dtStand + dtRep, fps, 15),
    ]) pipe.onFrame(t, pose);
    const lines = buildRepsCsv(pipe.finalize().reps).trim().split('\n');
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain('rep_id');
    expect(lines[1].split(',').length).toBe(lines[0].split(',').length);
  });

});
