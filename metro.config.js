/**
 * metro.config.js — METRO BUNDLER CONFIG + DEV-ONLY EXPORT ENDPOINT
 *
 * The primary mobile upload path now goes to FastAPI:
 *   POST /auth/token
 *   POST /sessions/exercise-result
 *
 * This Metro middleware remains available only for local dev artifact dumps.
 * It accepts session JSON + CSV blobs at /exports/session and writes them to
 * disk without requiring the Python backend.
 *
 * Files land in <repo>/exports/<UTC-stamp>_<session_id>/ on the Mac.
 *
 * If you want the app to use the real ingest path locally, point
 * BACKEND_URL in src/constants.ts at your FastAPI server (typically port 8000).
 */

const path = require('path');
const fs = require('fs');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const EXPORT_ROOT = path.resolve(__dirname, 'exports');

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      data += chunk;
      // 50MB hard cap — full-frame CSV from a 60s recording at 10fps is
      // ~600 frames × ~200 bytes ≈ 120KB, so this leaves an enormous margin.
      if (data.length > 50 * 1024 * 1024) {
        reject(new Error('payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function safeSegment(s) {
  return String(s || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64) || 'session';
}

function exportsMiddleware(req, res, next) {
  // Connectivity check — curl or browser: GET http://<laptop-ip>:8081/exports/ping
  if (req.url === '/exports/ping' && req.method === 'GET') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, exportRoot: EXPORT_ROOT }));
    return;
  }

  // ── POST /exports/session — small payload: session.json + reps.csv + reps.jsonl ──
  if (req.url === '/exports/session') {
    if (req.method !== 'POST') { res.statusCode = 405; res.end('Method Not Allowed'); return; }

    readJsonBody(req)
      .then(body => {
        const safeId = safeSegment(body.session_id);
        const stamp  = new Date().toISOString().replace(/[:.]/g, '-');
        const outDir = path.join(EXPORT_ROOT, `${stamp}_${safeId}`);
        fs.mkdirSync(outDir, { recursive: true });

        const written = [];
        const writeIf = (name, contents) => {
          if (typeof contents !== 'string') return; // skip undefined/null, but write empty strings
          const p = path.join(outDir, name);
          fs.writeFileSync(p, contents, 'utf8');
          written.push(p);
        };

        writeIf('session.json', body.summary_json);
        writeIf('reps.csv',     body.reps_csv);
        writeIf('reps.jsonl',   body.reps_jsonl);

        console.log(`[metro/exports] schema saved (${written.length} files) → ${outDir}`);

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ session_id: safeId, written_to: outDir, files: written }));
      })
      .catch(err => {
        console.error('[metro/exports/session] error:', err.message);
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  // ── POST /exports/frames — large payload: frames.csv only, appended to existing dir ──
  // Called as a separate fire-and-forget request so it can't abort the main export.
  if (req.url === '/exports/frames') {
    if (req.method !== 'POST') { res.statusCode = 405; res.end('Method Not Allowed'); return; }

    readJsonBody(req)
      .then(body => {
        const outDir = body.out_dir; // path returned by /exports/session
        if (!outDir || !fs.existsSync(outDir)) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'export dir not found — send /exports/session first' }));
          return;
        }

        const p = path.join(outDir, 'frames.csv');
        if (typeof body.frames_csv === 'string' && body.frames_csv.length > 0) {
          fs.writeFileSync(p, body.frames_csv, 'utf8');
          console.log(`[metro/exports] frames.csv saved → ${p}`);
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ written: p }));
      })
      .catch(err => {
        console.error('[metro/exports/frames] error:', err.message);
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  next();
}

const config = {
  server: {
    enhanceMiddleware: (metroMiddleware) => (req, res, next) => {
      // Run our handler first; if it doesn't claim the request, fall through
      // to Metro's normal bundler/asset middleware.
      exportsMiddleware(req, res, () => metroMiddleware(req, res, next));
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
