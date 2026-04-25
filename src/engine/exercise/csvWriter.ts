/**
 * src/engine/exercise/csvWriter.ts — CSV PERSISTENCE FOR THE EXERCISE PIPELINE
 *
 * Two flavours, matching the spec section 4:
 *
 *   Per-rep CSV (default — small, clean, the primary artifact):
 *     rep_id,side,depth,fppa_peak,fppa_depth,trunk_lean,trunk_flex,
 *     pelvic_drop,pelvic_shift,hip_adduction,knee_offset,sway,smoothness,
 *     errors_count,classification,duration_ms,confidence
 *
 *   Frame-level debug CSV (opt-in only):
 *     frame,timestamp,knee_flex,fppa,trunk_lean,trunk_flex,pelvic_drop,
 *     hip_adduction,knee_offset,midhip_x,midhip_y,velocity,side
 *
 * IO LAYER:
 *   On a real device we use @dr.pogodin/react-native-fs. In Node (tests)
 *   we use fs/promises. Both paths share the same row-formatting helpers.
 *   The fs adapter is injected via writeFile() so tests never need RN
 *   modules.
 */

import { FrameFeatures, RepFeatures } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Row formatters
// ─────────────────────────────────────────────────────────────────────────────

const REP_HEADER = [
  'rep_id', 'side',
  'depth_deg', 'rom_ratio',
  'fppa_peak', 'fppa_at_depth',
  'trunk_lean_peak', 'trunk_flex_peak',
  'pelvic_drop_peak', 'pelvic_shift_peak',
  'hip_adduction_peak', 'knee_offset_peak',
  'sway_norm', 'smoothness',
  'errors_count', 'classification',
  'err_knee_valgus', 'err_trunk_lean', 'err_trunk_flex',
  'err_pelvic_drop', 'err_pelvic_shift', 'err_hip_adduction',
  'err_knee_over_foot', 'err_balance',
  'start_frame', 'bottom_frame', 'end_frame', 'duration_ms',
  'confidence',
].join(',');

function fmt(n: number, decimals = 4): string {
  if (!Number.isFinite(n)) return '';
  return n.toFixed(decimals);
}

function repToRow(r: RepFeatures): string {
  const f = r.features;
  const e = r.errors;
  return [
    r.repId, r.side,
    fmt(f.kneeFlexionDeg, 2), fmt(f.romRatio, 3),
    fmt(f.fppaPeak, 2), fmt(f.fppaAtDepth, 2),
    fmt(f.trunkLeanPeak, 2), fmt(f.trunkFlexPeak, 2),
    fmt(f.pelvicDropPeak, 2), fmt(f.pelvicShiftPeak, 4),
    fmt(f.hipAdductionPeak, 2), fmt(f.kneeOffsetPeak, 4),
    fmt(f.swayNorm, 4), fmt(f.smoothness, 3),
    r.score.totalErrors, r.score.classification,
    e.kneeValgus ? 1 : 0, e.trunkLean ? 1 : 0, e.trunkFlex ? 1 : 0,
    e.pelvicDrop ? 1 : 0, e.pelvicShift ? 1 : 0, e.hipAdduction ? 1 : 0,
    e.kneeOverFoot ? 1 : 0, e.balance ? 1 : 0,
    r.timing.startFrame, r.timing.bottomFrame, r.timing.endFrame,
    r.timing.durationMs.toFixed(0),
    fmt(r.confidence, 3),
  ].join(',');
}

const FRAME_HEADER = [
  'frame', 'timestamp',
  'knee_flex', 'fppa',
  'trunk_lean', 'trunk_flex',
  'pelvic_drop', 'hip_adduction', 'knee_offset',
  'midhip_x', 'midhip_y', 'velocity', 'side',
].join(',');

function frameToRow(idx: number, f: FrameFeatures): string {
  return [
    idx, f.timestamp,
    fmt(f.kneeFlexion, 2), fmt(f.fppa, 2),
    fmt(f.trunkLean, 2), fmt(f.trunkFlex, 2),
    fmt(f.pelvicDrop, 2), fmt(f.hipAdduction, 2), fmt(f.kneeOffset, 4),
    fmt(f.midHipX, 4), fmt(f.midHipY, 4), fmt(f.velocityKneeFlex, 2),
    f.dominantSide,
  ].join(',');
}

// ─────────────────────────────────────────────────────────────────────────────
// Public string builders (no IO — tests use these directly)
// ─────────────────────────────────────────────────────────────────────────────

export function buildRepsCsv(reps: RepFeatures[]): string {
  return [REP_HEADER, ...reps.map(repToRow)].join('\n') + '\n';
}

export function buildFrameDebugCsv(frames: FrameFeatures[]): string {
  return [FRAME_HEADER, ...frames.map((f, i) => frameToRow(i, f))].join('\n') + '\n';
}

// ─────────────────────────────────────────────────────────────────────────────
// IO adapter
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal write-file shape; satisfied by both react-native-fs and node:fs. */
export interface WriteFileFn {
  (path: string, contents: string): Promise<void>;
}

export async function writeRepsCsv(
  path: string,
  reps: RepFeatures[],
  writeFile: WriteFileFn,
): Promise<void> {
  await writeFile(path, buildRepsCsv(reps));
}

export async function writeFrameDebugCsv(
  path: string,
  frames: FrameFeatures[],
  writeFile: WriteFileFn,
): Promise<void> {
  await writeFile(path, buildFrameDebugCsv(frames));
}
