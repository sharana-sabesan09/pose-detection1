/**
 * src/engine/csvLogger.ts — RAW POSE FRAME + REP CSV PERSISTENCE
 *
 * Writes session data to the device's Documents directory.
 *
 *   Documents/sentinel_sessions/<sessionId>.csv        — raw landmarks
 *   Documents/sentinel_sessions/<sessionId>_reps.csv   — per-rep summary
 *   Documents/sentinel_sessions/<sessionId>_session.json
 *
 * NATIVE MODULE STRATEGY:
 *   This file uses @dr.pogodin/react-native-fs BUT only via a lazy require()
 *   inside each async function — never at module import time. That means:
 *
 *   • If the app was built WITHOUT pod install (native side missing), every
 *     call gracefully catches and logs a warning. The app keeps running.
 *   • If the pod IS installed, writes work as normal.
 *   • No top-level RNFS reference that could crash the module on startup.
 */

import { PoseFrame, SessionMode } from '../types';
import { RecordedFrame } from './analyzeRecording';
import { RepFeatures, SessionSummary } from './exercise/types';
import { buildRepsCsv } from './exercise/csvWriter';

// ─────────────────────────────────────────────────────────────────────────────
// RNFS lazy accessor — never call at module scope
// ─────────────────────────────────────────────────────────────────────────────

function getRNFS(): typeof import('@dr.pogodin/react-native-fs').default | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@dr.pogodin/react-native-fs');
    return mod?.default ?? mod ?? null;
  } catch {
    return null;
  }
}

/** Documents/sentinel_sessions — resolved lazily so nothing fires at import time. */
function getSessionsDir(): string | null {
  const RNFS = getRNFS();
  if (!RNFS || !RNFS.DocumentDirectoryPath) return null;
  return `${RNFS.DocumentDirectoryPath}/sentinel_sessions`;
}

/** Idempotent directory creation. Returns false if RNFS not available. */
async function ensureSessionsDir(): Promise<string | null> {
  const RNFS = getRNFS();
  const dir = getSessionsDir();
  if (!RNFS || !dir) return null;
  const exists = await RNFS.exists(dir);
  if (!exists) await RNFS.mkdir(dir);
  return dir;
}

// ─────────────────────────────────────────────────────────────────────────────
// LANDMARK CSV (raw frames)
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

/** Safe path for a given session id (strips characters iOS/Android dislike). */
function safeName(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9_.-]/g, '_');
}

/**
 * writeRecordingCsv — persist raw landmark frames for a session.
 * No-ops silently if RNFS native module is not linked.
 */
export async function writeRecordingCsv(
  sessionId: string,
  frames: RecordedFrame[],
  mode: SessionMode,
): Promise<string | null> {
  const RNFS = getRNFS();
  const dir = await ensureSessionsDir();
  if (!RNFS || !dir) {
    console.warn('[csvLogger] react-native-fs not available — skipping raw CSV write');
    return null;
  }

  const path = `${dir}/${safeName(sessionId)}.csv`;
  const lines: string[] = [buildLandmarkHeader()];
  for (const { t, pose } of frames) {
    lines.push(frameToRow(t, mode, pose));
  }
  await RNFS.writeFile(path, lines.join('\n') + '\n', 'utf8');
  return path;
}

// ─────────────────────────────────────────────────────────────────────────────
// PER-REP CSV
// ─────────────────────────────────────────────────────────────────────────────

/**
 * writeRepsCsvForSession — persist per-rep features from the exercise pipeline.
 * No-ops silently if RNFS native module is not linked.
 */
export async function writeRepsCsvForSession(
  sessionId: string,
  reps: RepFeatures[],
): Promise<string | null> {
  const RNFS = getRNFS();
  const dir = await ensureSessionsDir();
  if (!RNFS || !dir) {
    console.warn('[csvLogger] react-native-fs not available — skipping reps CSV write');
    return null;
  }

  const path = `${dir}/${safeName(sessionId)}_reps.csv`;
  await RNFS.writeFile(path, buildRepsCsv(reps), 'utf8');
  return path;
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION SUMMARY JSON
// ─────────────────────────────────────────────────────────────────────────────

/**
 * writeSessionSummaryJson — persist the structured session summary.
 * No-ops silently if RNFS native module is not linked.
 */
export async function writeSessionSummaryJson(
  sessionId: string,
  summary: SessionSummary,
): Promise<string | null> {
  const RNFS = getRNFS();
  const dir = await ensureSessionsDir();
  if (!RNFS || !dir) {
    console.warn('[csvLogger] react-native-fs not available — skipping session JSON write');
    return null;
  }

  const path = `${dir}/${safeName(sessionId)}_session.json`;
  await RNFS.writeFile(path, JSON.stringify(summary, null, 2), 'utf8');
  return path;
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────────────────────────────────────

/** List every saved CSV in the sessions folder, newest first. */
export async function listSessionCsvs(): Promise<
  { name: string; path: string; size: number; mtime: Date | null }[]
> {
  const RNFS = getRNFS();
  const dir = getSessionsDir();
  if (!RNFS || !dir) return [];

  const exists = await RNFS.exists(dir);
  if (!exists) return [];

  const items = await RNFS.readDir(dir);
  return items
    .filter(i => i.isFile() && i.name.endsWith('.csv'))
    .map(i => ({
      name:  i.name,
      path:  i.path,
      size:  Number(i.size ?? 0),
      mtime: i.mtime ?? null,
    }))
    .sort((a, b) => (b.mtime?.getTime() ?? 0) - (a.mtime?.getTime() ?? 0));
}

/** Delete all CSVs from the sessions folder. */
export async function clearAllSessionCsvs(): Promise<void> {
  const RNFS = getRNFS();
  const dir = getSessionsDir();
  if (!RNFS || !dir) return;

  const exists = await RNFS.exists(dir);
  if (!exists) return;

  const items = await RNFS.readDir(dir);
  await Promise.all(
    items.filter(i => i.isFile() && i.name.endsWith('.csv')).map(i => RNFS.unlink(i.path)),
  );
}
