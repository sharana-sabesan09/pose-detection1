#!/usr/bin/env node
/**
 * tools/session-receiver.js — LOCAL DATA RECEIVER
 *
 * A tiny HTTP server that runs on your laptop and receives session data
 * POSTed from the iOS simulator (which shares localhost with the Mac).
 *
 * After each recording the app POSTs JSON to this server, which then
 * writes files into tools/data/:
 *
 *   tools/data/<sessionId>_session.json   — full session + reps
 *   tools/data/<sessionId>_reps.csv       — per-rep CSV (open in Excel / Numbers)
 *   tools/data/<sessionId>_frames.csv     — raw landmark frames (optional, large)
 *
 * USAGE:
 *   node tools/session-receiver.js
 *   # leave it running, then use the app — files appear in tools/data/ after each recording
 *
 * PORT: 3001 (change PORT below if that's taken)
 */

const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const PORT     = 3001;
const DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─────────────────────────────────────────────────────────────────────────────
// CSV builders (mirror of src/engine/exercise/csvWriter.ts)
// ─────────────────────────────────────────────────────────────────────────────

const REP_HEADER = [
  'rep_id','side',
  'depth_deg','rom_ratio',
  'fppa_peak','fppa_at_depth',
  'trunk_lean_peak','trunk_flex_peak',
  'pelvic_drop_peak','pelvic_shift_peak',
  'hip_adduction_peak','knee_offset_peak',
  'sway_norm','smoothness',
  'errors_count','classification',
  'err_knee_valgus','err_trunk_lean','err_trunk_flex',
  'err_pelvic_drop','err_pelvic_shift','err_hip_adduction',
  'err_knee_over_foot','err_balance',
  'start_frame','bottom_frame','end_frame','duration_ms',
  'confidence',
].join(',');

function repToRow(r) {
  const f = r.features, e = r.errors;
  const fmt = (n, d=4) => typeof n === 'number' && isFinite(n) ? n.toFixed(d) : '';
  return [
    r.repId, r.side,
    fmt(f.kneeFlexionDeg,2), fmt(f.romRatio,3),
    fmt(f.fppaPeak,2),       fmt(f.fppaAtDepth,2),
    fmt(f.trunkLeanPeak,2),  fmt(f.trunkFlexPeak,2),
    fmt(f.pelvicDropPeak,2), fmt(f.pelvicShiftPeak,4),
    fmt(f.hipAdductionPeak,2),fmt(f.kneeOffsetPeak,4),
    fmt(f.swayNorm,4),       fmt(f.smoothness,3),
    r.score.totalErrors,     r.score.classification,
    e.kneeValgus?1:0, e.trunkLean?1:0, e.trunkFlex?1:0,
    e.pelvicDrop?1:0, e.pelvicShift?1:0, e.hipAdduction?1:0,
    e.kneeOverFoot?1:0, e.balance?1:0,
    r.timing.startFrame, r.timing.bottomFrame, r.timing.endFrame,
    Math.round(r.timing.durationMs),
    fmt(r.confidence,3),
  ].join(',');
}

function buildRepsCsv(reps) {
  return [REP_HEADER, ...reps.map(repToRow)].join('\n') + '\n';
}

const LANDMARK_COUNT = 33;
const FRAME_HEADER = ['t','mode',
  ...Array.from({length: LANDMARK_COUNT}, (_,i) =>
    [`lm${i}_x`,`lm${i}_y`,`lm${i}_z`,`lm${i}_v`]).flat(),
].join(',');

function frameToRow(t, mode, pose) {
  const cells = [t, mode];
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const lm = pose[i];
    if (lm) cells.push(lm.x.toFixed(4),lm.y.toFixed(4),lm.z.toFixed(4),(lm.visibility??0).toFixed(4));
    else     cells.push('','','','');
  }
  return cells.join(',');
}

function buildFramesCsv(frames, mode) {
  const rows = [FRAME_HEADER];
  for (const {t, pose} of frames) rows.push(frameToRow(t, mode, pose));
  return rows.join('\n') + '\n';
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP server
// ─────────────────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  // CORS so the WebView / RN fetch can reach us from any origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST' && req.url === '/session') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const { sessionId, session, frames, mode } = payload;

        if (!sessionId) throw new Error('missing sessionId');

        const safe = sessionId.replace(/[^A-Za-z0-9_.-]/g, '_');

        // 1. Full session JSON
        const jsonPath = path.join(DATA_DIR, `${safe}_session.json`);
        fs.writeFileSync(jsonPath, JSON.stringify(session, null, 2));

        // 2. Per-rep CSV
        const repCsvPath = path.join(DATA_DIR, `${safe}_reps.csv`);
        if (session?.reps?.length > 0) {
          fs.writeFileSync(repCsvPath, buildRepsCsv(session.reps));
        }

        // 3. Raw frames CSV (optional — only written if frames were sent)
        let frameMsg = '';
        if (frames?.length > 0) {
          const frameCsvPath = path.join(DATA_DIR, `${safe}_frames.csv`);
          fs.writeFileSync(frameCsvPath, buildFramesCsv(frames, mode ?? 'unknown'));
          frameMsg = ` + ${frames.length} raw frames`;
        }

        const repCount = session?.reps?.length ?? 0;
        console.log(
          `✅  [${new Date().toLocaleTimeString()}]  session ${safe}` +
          `  ${repCount} rep(s)${frameMsg}` +
          `  → data/${safe}_*.{json,csv}`
        );

        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ok: true, files: {json: jsonPath, csv: repCsvPath}}));

      } catch (err) {
        console.error('❌  parse error:', err.message, '\nbody:', body.slice(0, 200));
        res.writeHead(400, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ok: false, error: err.message}));
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({ok: true, dataDir: DATA_DIR}));
    return;
  }

  res.writeHead(404); res.end();
});

server.listen(PORT, () => {
  console.log(`\n🎯  Sentinel session receiver running`);
  console.log(`   POST http://localhost:${PORT}/session  ← app sends data here`);
  console.log(`   Files land in: ${DATA_DIR}/\n`);
});
