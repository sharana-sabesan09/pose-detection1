/**
 * metro.config.js — METRO BUNDLER CONFIG + DEV-ONLY EXPORT ENDPOINT
 *
 * The phone POSTs session artifacts (full schema JSON, per-rep CSV, raw
 * landmark CSV, per-rep JSONL) to http://<laptop-ip>:8081/exports/session
 * while Metro is running. We attach a tiny middleware to Metro's existing
 * dev server so we don't have to spin up a separate FastAPI / node server
 * just to receive the artifacts during development.
 *
 * Files land in <repo>/exports/<UTC-stamp>_<session_id>/ on the Mac.
 *
 * If you ever switch to running the FastAPI backend (backend/run_agent.py),
 * point BACKEND_URL in src/constants.ts at that server instead — the route
 * shape (POST /exports/session) is identical.
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
  if (req.url !== '/exports/session') return next();
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    res.end('Method Not Allowed');
    return;
  }

  readJsonBody(req)
    .then(body => {
      const safeId = safeSegment(body.session_id);
      const stamp  = new Date().toISOString().replace(/[:.]/g, '-');
      const outDir = path.join(EXPORT_ROOT, `${stamp}_${safeId}`);
      fs.mkdirSync(outDir, { recursive: true });

      const written = [];
      const writeIf = (name, contents) => {
        if (typeof contents !== 'string' || contents.length === 0) return;
        const p = path.join(outDir, name);
        fs.writeFileSync(p, contents, 'utf8');
        written.push(p);
      };

      writeIf('session.json', body.summary_json);
      writeIf('reps.csv',     body.reps_csv);
      writeIf('reps.jsonl',   body.reps_jsonl);
      writeIf('frames.csv',   body.frames_csv);

      console.log(`[metro/exports] ${written.length} file(s) → ${outDir}`);

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        session_id: safeId,
        written_to: outDir,
        files:      written,
      }));
    })
    .catch(err => {
      console.warn('[metro/exports] failed:', err.message);
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err.message }));
    });
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
