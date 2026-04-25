/**
 * src/engine/csvLogger.ts — RAW POSE FRAME CSV PERSISTENCE
 *
 * Writes every captured pose frame from a recording session to a CSV file
 * inside the app's persistent Documents directory.
 *
 *   Documents/sentinel_sessions/<sessionId>.csv
 *
 * The CSV format is "wide" — one row per frame, with all 33 MediaPipe
 * landmarks flattened across the columns:
 *
 *   t,mode,lm0_x,lm0_y,lm0_z,lm0_v,lm1_x,...,lm32_v
 *
 * That's 2 metadata columns + 33 × 4 = 134 columns total.
 *
 * SIZE NOTE:
 *   At ~30fps with each value rounded to 4 decimals, one frame is roughly
 *   1.2 KB of CSV text. 60 seconds → ~2 MB per recording. A few hundred
 *   recordings comfortably fit in local app storage.
 *
 * WHY WIDE FORMAT (not long):
 *   It matches the natural per-frame analysis already done in
 *   analyzeRecording.ts — one row, one moment in time. Easier to load into
 *   pandas, R, Excel, etc. without a pivot.
 */

import RNFS from '@dr.pogodin/react-native-fs';
import { PoseFrame, SessionMode } from '../types';
import { RecordedFrame } from './analyzeRecording';
import { RepFeatures, SessionSummary } from './exercise/types';
import { buildRepsCsv } from './exercise/csvWriter';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Folder under Documents/ that holds one CSV per recording session. */
const SESSIONS_DIR = `${RNFS.DocumentDirectoryPath}/sentinel_sessions`;

/** MediaPipe Pose returns 33 landmarks per frame. */
const LANDMARK_COUNT = 33;

/** Float precision in the CSV. 4 decimals = ~0.1px on a 1080p frame. */
const DECIMALS = 4;

// ─────────────────────────────────────────────────────────────────────────────
// HEADER
// ─────────────────────────────────────────────────────────────────────────────

function buildHeader(): string {
  const cols = ['t', 'mode'];
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    cols.push(`lm${i}_x`, `lm${i}_y`, `lm${i}_z`, `lm${i}_v`);
  }
  return cols.join(',');
}

// ─────────────────────────────────────────────────────────────────────────────
// ROW FORMATTING
// ─────────────────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '';
  return n.toFixed(DECIMALS);
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

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/** Make sure Documents/sentinel_sessions/ exists. Idempotent. */
async function ensureSessionsDir(): Promise<void> {
  const exists = await RNFS.exists(SESSIONS_DIR);
  if (!exists) {
    await RNFS.mkdir(SESSIONS_DIR);
  }
}

/** Absolute path of the CSV file for a given session id. */
export function csvPathFor(sessionId: string): string {
  // Replace characters that are awkward on iOS/Android filesystems
  // (colons from ISO timestamps).
  const safe = sessionId.replace(/[^A-Za-z0-9_.-]/g, '_');
  return `${SESSIONS_DIR}/${safe}.csv`;
}

/**
 * writeRecordingCsv — DUMP AN ENTIRE RECORDED SESSION TO A CSV FILE
 *
 * Called from SessionScreen.finishRecording right after the recording stops.
 * Writes the full set of {t, pose} frames in one bulk write — much faster
 * and safer than appending per frame.
 *
 * @param sessionId  Unique id (we use the AnalysisResult.id ISO timestamp)
 * @param frames     The raw recorded frames captured during the session
 * @param mode       The session mode active when recording started
 * @returns          Absolute path of the written CSV
 */
export async function writeRecordingCsv(
  sessionId: string,
  frames: RecordedFrame[],
  mode: SessionMode,
): Promise<string> {
  await ensureSessionsDir();

  const path = csvPathFor(sessionId);
  const header = buildHeader();

  // Build the body in one string. ~2 MB for a 60s recording — fine for memory.
  const lines: string[] = [header];
  for (const { t, pose } of frames) {
    lines.push(frameToRow(t, mode, pose));
  }
  const csv = lines.join('\n') + '\n';

  await RNFS.writeFile(path, csv, 'utf8');
  return path;
}

/**
 * listSessionCsvs — RETURN METADATA FOR EVERY SAVED RECORDING
 *
 * Useful for debug screens, manual export, or future "upload to backend"
 * sync jobs. Returns newest first.
 */
export async function listSessionCsvs(): Promise<
  { name: string; path: string; size: number; mtime: Date | null }[]
> {
  const exists = await RNFS.exists(SESSIONS_DIR);
  if (!exists) return [];

  const items = await RNFS.readDir(SESSIONS_DIR);
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

/**
 * writeRepsCsvForSession — write the per-rep CSV emitted by the exercise
 * pipeline next to the raw frames CSV for the same session id. Filename
 *
 *   <sessionId>_reps.csv
 *
 * Produced from `pipeline.finalize().reps` after recording stops.
 */
export async function writeRepsCsvForSession(
  sessionId: string,
  reps: RepFeatures[],
): Promise<string> {
  await ensureSessionsDir();
  const safe = sessionId.replace(/[^A-Za-z0-9_.-]/g, '_');
  const path = `${SESSIONS_DIR}/${safe}_reps.csv`;
  await RNFS.writeFile(path, buildRepsCsv(reps), 'utf8');
  return path;
}

/**
 * writeSessionSummaryJson — store the structured session summary alongside
 * the CSVs as `<sessionId>_session.json`. Useful for the dashboard later.
 */
export async function writeSessionSummaryJson(
  sessionId: string,
  summary: SessionSummary,
): Promise<string> {
  await ensureSessionsDir();
  const safe = sessionId.replace(/[^A-Za-z0-9_.-]/g, '_');
  const path = `${SESSIONS_DIR}/${safe}_session.json`;
  await RNFS.writeFile(path, JSON.stringify(summary, null, 2), 'utf8');
  return path;
}

/** Delete every recording CSV. Useful for "clear data" actions. */
export async function clearAllSessionCsvs(): Promise<void> {
  const exists = await RNFS.exists(SESSIONS_DIR);
  if (!exists) return;
  const items = await RNFS.readDir(SESSIONS_DIR);
  await Promise.all(
    items.filter(i => i.isFile() && i.name.endsWith('.csv')).map(i => RNFS.unlink(i.path)),
  );
}
