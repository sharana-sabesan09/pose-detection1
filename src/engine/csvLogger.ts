/**
 * src/engine/csvLogger.ts — SESSION DATA PERSISTENCE
 *
 * File-system CSV writing requires @dr.pogodin/react-native-fs (a native module
 * that needs pod install + a native rebuild). Until that is set up, this module
 * provides the same public API but no-ops all writes — the exercise pipeline,
 * rep detection, and scoring all run normally; data just isn't persisted to disk.
 *
 * TO ENABLE FILE WRITING:
 *   1. `npm install` (package is already in package.json as a comment below)
 *   2. `cd ios && pod install && cd ..`
 *   3. Rebuild the native app
 *   4. Uncomment the RNFS implementation block below
 */

import { PoseFrame, SessionMode } from '../types';
import { RecordedFrame } from './analyzeRecording';
import { RepFeatures, SessionSummary } from './exercise/types';
import { buildRepsCsv } from './exercise/csvWriter';

// ─────────────────────────────────────────────────────────────────────────────
// STRING BUILDERS (no IO — pure TS, always available)
// ─────────────────────────────────────────────────────────────────────────────

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

/** Build the raw-frames CSV string (always works, just not written to disk yet). */
export function buildLandmarkCsv(frames: RecordedFrame[], mode: SessionMode): string {
  const lines = [buildLandmarkHeader()];
  for (const { t, pose } of frames) lines.push(frameToRow(t, mode, pose));
  return lines.join('\n') + '\n';
}

// Re-export so callers can get the rep CSV string too.
export { buildRepsCsv };

// ─────────────────────────────────────────────────────────────────────────────
// FILE-WRITE API — no-op stubs (safe with no native module)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * writeRecordingCsv — writes raw landmark frames to disk.
 * Currently a no-op; returns null until react-native-fs is set up.
 */
export async function writeRecordingCsv(
  _sessionId: string,
  _frames: RecordedFrame[],
  _mode: SessionMode,
): Promise<string | null> {
  // File writing disabled — react-native-fs native pod not yet installed.
  // The CSV string is available via buildLandmarkCsv() for logging/debugging.
  return null;
}

/**
 * writeRepsCsvForSession — writes per-rep features to disk.
 * Currently a no-op; returns null until react-native-fs is set up.
 */
export async function writeRepsCsvForSession(
  _sessionId: string,
  _reps: RepFeatures[],
): Promise<string | null> {
  return null;
}

/**
 * writeSessionSummaryJson — writes session summary JSON to disk.
 * Currently a no-op; returns null until react-native-fs is set up.
 */
export async function writeSessionSummaryJson(
  _sessionId: string,
  _summary: SessionSummary,
): Promise<string | null> {
  return null;
}

/** listSessionCsvs — no-op until file system access is enabled. */
export async function listSessionCsvs(): Promise<
  { name: string; path: string; size: number; mtime: Date | null }[]
> {
  return [];
}

/** clearAllSessionCsvs — no-op until file system access is enabled. */
export async function clearAllSessionCsvs(): Promise<void> {
  // nothing to clear
}
