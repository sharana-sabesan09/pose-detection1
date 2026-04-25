/**
 * src/engine/csvLogger.ts — IN-MEMORY CSV STRING BUILDERS
 *
 * Builds the CSV strings consumed by the exporter (Share sheet + backend
 * POST). No filesystem writes happen here — the device never had
 * react-native-fs installed, so persistence happens via the backend at
 * <repo>/exports/<stamp>_<session_id>/ instead.
 *
 *   buildLandmarkCsv  — raw 33-landmark frames per row, used for debug.
 *   buildRepsCsv      — one row per rep (re-exported from exercise/csvWriter).
 */

import { PoseFrame, SessionMode } from '../types';
import { RecordedFrame } from './analyzeRecording';
import { buildRepsCsv } from './exercise/csvWriter';

const LANDMARK_COUNT = 33;
const DECIMALS = 4;

function buildLandmarkHeader(): string {
  const cols = ['t', 'mode'];
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    cols.push(`lm${i}_x`, `lm${i}_y`, `lm${i}_z`, `lm${i}_v`);
  }
  return cols.join(',');
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(DECIMALS) : '';
}

function frameToRow(t: number, mode: SessionMode, pose: PoseFrame): string {
  const cells: string[] = [String(t), mode];
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const lm = pose[i];
    if (lm) {
      cells.push(fmt(lm.x), fmt(lm.y), fmt(lm.z), fmt(lm.visibility ?? 0));
    } else {
      cells.push('', '', '', '');
    }
  }
  return cells.join(',');
}

export function buildLandmarkCsv(frames: RecordedFrame[], mode: SessionMode): string {
  const lines = [buildLandmarkHeader()];
  for (const { t, pose } of frames) lines.push(frameToRow(t, mode, pose));
  return lines.join('\n') + '\n';
}

export { buildRepsCsv };
