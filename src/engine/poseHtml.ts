/**
 * src/engine/poseHtml.ts — MEDIAPIPE POSE HTML FOR WEBVIEW
 *
 * Landmark coordinates from MediaPipe are in raw video space [0,1].
 * The video element uses object-fit:cover, so it is zoomed and cropped
 * to fill the screen. Without correction, landmarks appear shifted —
 * the head sits at the neck and feet sit at the ankles.
 *
 * Fix: compute the object-fit:cover scale + offset and re-normalise each
 * landmark into screen [0,1] space before drawing or posting to RN.
 * DrawingUtils multiplies x by canvas.width and y by canvas.height, so
 * keeping canvas in screen pixels and passing screen-normalised landmarks
 * places every joint exactly where the video pixel appears on screen.
 */

import { GHOST_CYCLE_BY_EXERCISE } from './calibrationGhostCycles.generated';

export const POSE_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100vw; height: 100vh; overflow: hidden; background: #000; }
    video  {
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      object-fit: cover;
      transform: scaleX(-1);
      transform-origin: center;
    }
    canvas {
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none;
      transform: scaleX(-1);
      transform-origin: center;
    }
    #msg   { position: absolute; top: 12px; left: 12px; color: #fff; font: 12px monospace;
             background: rgba(0,0,0,0.6); padding: 4px 8px; border-radius: 4px; }
  </style>
</head>
<body>
  <video id="v" autoplay playsinline muted></video>
  <canvas id="c"></canvas>
  <div id="msg">Loading MediaPipe…</div>

  <script>
    (function () {
      var lastAudio = null;
      window.playAudio = function (b64) {
        if (!b64 || typeof b64 !== 'string') return;
        try {
          if (lastAudio) {
            try { lastAudio.pause(); } catch (e) {}
            lastAudio.removeAttribute('src');
            lastAudio.load();
          }
          var a = new Audio('data:audio/mpeg;base64,' + b64);
          a.setAttribute('playsinline', '');
          a.playsInline = true;
          lastAudio = a;
          var p = a.play();
          if (p && typeof p.catch === 'function') p.catch(function () {});
        } catch (e) {}
      };
    })();
  </script>
  <script type="module">
    import { PoseLandmarker, FilesetResolver, DrawingUtils }
      from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm';

    const video = document.getElementById('v');
    const canvas = document.getElementById('c');
    const msg    = document.getElementById('msg');
    const ctx    = canvas.getContext('2d');

    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );

    const landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence:  0.5,
      minTrackingConfidence:      0.5
    });

    msg.textContent = 'Starting camera…';
    const draw = new DrawingUtils(ctx);
    let lastTs = -1;

    // ── Live ghost trainer (looped reference pose from bundled calibration cycles)
    const GHOST_CYCLES = ${JSON.stringify(GHOST_CYCLE_BY_EXERCISE)};
    /** Wall-clock ms per 1.0 step along the keyframe index (lerped every rAF). */
    const GHOST_MS_PER_KEYFRAME = 204;
    /** Fullscreen trainer panel, then fly to corner after ~a couple of demo reps at this tempo. */
    const GHOST_INTRO_FULLSCREEN_MS = 12000;
    /** Panel morphs fullscreen → corner PiP over this duration (ease-in-out). */
    const GHOST_LAYOUT_TRANSITION_MS = 700;
    const GHOST_PANEL_BG = '#C2B280';
    const GHOST_FILL_TRAINER = '#ffffff';
    const GHOST_OUTLINE_TRAINER = '#000000';
    const GHOST_CORNER_MARGIN = 16;
    const GHOST_CORNER_W_FRAC = 0.28;
    const GHOST_CORNER_H_FRAC = 0.34;
    const GHOST_CONNECTIONS = [
      [11,12],[11,23],[12,24],[23,24],
      [23,25],[25,27],[27,29],[24,26],[26,28],[28,30],
      [11,13],[13,15],[12,14],[14,16],
    ];

    /** Shoulder–hip perimeter; filled first so torso isn’t four overlapping capsules. */
    const GHOST_TORSO_LOOP = [11, 12, 24, 23];

    function ghostTorsoEdgeExcludedFromCapsules(a, b) {
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      return (
        (lo === 11 && hi === 12) ||
        (lo === 11 && hi === 23) ||
        (lo === 12 && hi === 24) ||
        (lo === 23 && hi === 24)
      );
    }

    /** Half-width multiplier per bone pair (1 = base); thinner distal limbs, wider torso/hips. */
    function ghostLimbHalfWMult(a, b) {
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      const key = lo + '-' + hi;
      const m = {
        '11-12': 1.2,
        '11-23': 1.02, '12-24': 1.02,
        '23-24': 1.28,
        '23-25': 1.1, '24-26': 1.1,
        '25-27': 0.66, '26-28': 0.66,
        '27-29': 0.74, '28-30': 0.74,
        '11-13': 0.78, '12-14': 0.78,
        '13-15': 0.52, '14-16': 0.52,
      };
      return m[key] != null ? m[key] : 1;
    }

    const GHOST_JOINT_R_MULT = {
      11: 1.14, 12: 1.14,
      13: 1.02, 14: 1.02,
      15: 0.72, 16: 0.72,
      23: 1.18, 24: 1.18,
      25: 1.05, 26: 1.05,
      27: 0.98, 28: 0.98,
    };

    // RN injects the current exercise after the page loads. Default to hidden so
    // the screen never flashes an outdated calibration ghost on boot/remount.
    let ghostExercise = 'walking';
    /** Continuous index into the cycle [0, n); advances every rAF for smooth interpolation. */
    let ghostPhase = 0;
    let ghostLastRafNow = 0;
    let lastAlignedLandmarks = null;
    /** 'fullscreen' | 'transition' | 'corner' — panel shrinks to bottom-right PiP. */
    let ghostLayoutStage = 'corner';
    let ghostIntroStartedMs = 0;
    let ghostTransitionStartMs = 0;

    window.__setGhostExercise = (ex) => {
      ghostExercise = ex || 'walking';
      ghostPhase = 0;
    };

    window.__ghostStartRecordingLayout = function () {
      ghostLayoutStage = 'fullscreen';
      ghostIntroStartedMs = performance.now();
    };

    function alignGhostLm(lm, vw, vh, scale, ox, oy, W, H) {
      return {
        x: (lm.x * vw * scale + ox) / W,
        y: (lm.y * vh * scale + oy) / H,
        z: lm.z,
        v: lm.v,
      };
    }

    /** Screen pixel point from normalised ghost landmark. */
    function ghostPx(lm, vw, vh, scale, ox, oy, W, H) {
      const a = alignGhostLm(lm, vw, vh, scale, ox, oy, W, H);
      return { x: a.x * W, y: a.y * H, v: a.v };
    }

    function lerpLandmarks(fr0, fr1, t) {
      const u = t < 0 ? 0 : t > 1 ? 1 : t;
      const out = new Array(33);
      for (let i = 0; i < 33; i++) {
        const a = fr0[i], b = fr1[i];
        out[i] = {
          x: a.x + (b.x - a.x) * u,
          y: a.y + (b.y - a.y) * u,
          z: a.z + (b.z - a.z) * u,
          v: a.v + (b.v - a.v) * u,
        };
      }
      return out;
    }

    function fillStrokeTorsoQuad(frame, vw, vh, sc, ox, oy, W, H, outlineW) {
      const pts = [];
      for (const idx of GHOST_TORSO_LOOP) {
        const p = ghostPx(frame[idx], vw, vh, sc, ox, oy, W, H);
        if (p.v < 0.2) return;
        pts.push(p);
      }
      if (pts.length !== 4) return;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fillStyle = GHOST_FILL_TRAINER;
      ctx.fill();
      ctx.strokeStyle = GHOST_OUTLINE_TRAINER;
      ctx.lineWidth = outlineW;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    /** Filled limb “tube” + black outline between two screen points. */
    function fillStrokeLimbCapsule(ctx, ax, ay, bx, by, halfW, outlineW) {
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * halfW;
      const ny = (dx / len) * halfW;
      ctx.beginPath();
      ctx.moveTo(ax + nx, ay + ny);
      ctx.lineTo(ax - nx, ay - ny);
      ctx.lineTo(bx - nx, by - ny);
      ctx.lineTo(bx + nx, by + ny);
      ctx.closePath();
      ctx.fillStyle = GHOST_FILL_TRAINER;
      ctx.fill();
      ctx.strokeStyle = GHOST_OUTLINE_TRAINER;
      ctx.lineWidth = outlineW;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    const GHOST_JOINT_IDX = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

    function ghostBBoxScreenPx(frame, vw, vh, sc, ox, oy, W, H) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      function acc(lm) {
        const p = ghostPx(lm, vw, vh, sc, ox, oy, W, H);
        if (p.v < 0.2) return;
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
      for (const [a, b] of GHOST_CONNECTIONS) {
        acc(frame[a]); acc(frame[b]);
      }
      for (const i of GHOST_JOINT_IDX) acc(frame[i]);
      acc(frame[0]);
      if (minX === Infinity) return null;
      const pad = 40;
      return { minX: minX - pad, maxX: maxX + pad, minY: minY - pad, maxY: maxY + pad };
    }

    function easeInOutCubic(t) {
      const x = t < 0 ? 0 : t > 1 ? 1 : t;
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    }

    function ghostPanelRects(W, H) {
      const cw = Math.round(W * GHOST_CORNER_W_FRAC);
      const ch = Math.round(H * GHOST_CORNER_H_FRAC);
      const cx = W - cw - GHOST_CORNER_MARGIN;
      const cy = H - ch - GHOST_CORNER_MARGIN;
      return {
        fullscreen: { x: 0, y: 0, w: W, h: H },
        corner: { x: cx, y: cy, w: cw, h: ch },
      };
    }

    function drawGhostInTrainerPanel(
      frame, vw, vh, sc, ox, oy, W, H, baseLimbHalf, jointRBase,
      panelX, panelY, panelW, panelH, innerPad,
    ) {
      const bb = ghostBBoxScreenPx(frame, vw, vh, sc, ox, oy, W, H);
      if (!bb) return;
      const cx = (bb.minX + bb.maxX) / 2;
      const cy = (bb.minY + bb.maxY) / 2;
      const bw = Math.max(bb.maxX - bb.minX, 48);
      const bh = Math.max(bb.maxY - bb.minY, 72);
      const pad = innerPad;
      const s = Math.min((panelW - 2 * pad) / bw, (panelH - 2 * pad) / bh);
      ctx.save();
      ctx.fillStyle = GHOST_PANEL_BG;
      ctx.fillRect(Math.floor(panelX), Math.floor(panelY), Math.ceil(panelW), Math.ceil(panelH));
      ctx.translate(panelX + panelW / 2, panelY + panelH / 2);
      ctx.scale(s, s);
      ctx.translate(-cx, -cy);
      drawGhostSilhouetteInCurrentTransform(frame, vw, vh, sc, ox, oy, W, H, baseLimbHalf, jointRBase);
      ctx.restore();
    }

    function drawGhostSilhouetteInCurrentTransform(frame, vw, vh, sc, ox, oy, W, H, baseLimbHalf, jointRBase) {
      ctx.globalAlpha = 1;
      const torsoOw = Math.max(2.4, Math.min(4.2, baseLimbHalf * 0.42));
      fillStrokeTorsoQuad(frame, vw, vh, sc, ox, oy, W, H, torsoOw);
      for (const [a, b] of GHOST_CONNECTIONS) {
        if (ghostTorsoEdgeExcludedFromCapsules(a, b)) continue;
        const pa = ghostPx(frame[a], vw, vh, sc, ox, oy, W, H);
        const pb = ghostPx(frame[b], vw, vh, sc, ox, oy, W, H);
        if (pa.v < 0.2 || pb.v < 0.2) continue;
        const hw = baseLimbHalf * ghostLimbHalfWMult(a, b);
        const ow = Math.max(2, Math.min(4, hw * 0.34));
        fillStrokeLimbCapsule(ctx, pa.x, pa.y, pb.x, pb.y, hw, ow);
      }
      for (const i of GHOST_JOINT_IDX) {
        const p = ghostPx(frame[i], vw, vh, sc, ox, oy, W, H);
        if (p.v < 0.2) continue;
        const jr = jointRBase * (GHOST_JOINT_R_MULT[i] != null ? GHOST_JOINT_R_MULT[i] : 1);
        ctx.beginPath();
        ctx.arc(p.x, p.y, jr, 0, Math.PI * 2);
        ctx.fillStyle = GHOST_FILL_TRAINER;
        ctx.fill();
        ctx.strokeStyle = GHOST_OUTLINE_TRAINER;
        ctx.lineWidth = Math.max(2, Math.min(3.5, jr * 0.26));
        ctx.stroke();
      }
      const p11 = ghostPx(frame[11], vw, vh, sc, ox, oy, W, H);
      const p12 = ghostPx(frame[12], vw, vh, sc, ox, oy, W, H);
      const nose = ghostPx(frame[0], vw, vh, sc, ox, oy, W, H);
      if (nose.v >= 0.2 && p11.v >= 0.2 && p12.v >= 0.2) {
        const mx = (p11.x + p12.x) / 2;
        const my = (p11.y + p12.y) / 2;
        const nh = baseLimbHalf * 0.4;
        fillStrokeLimbCapsule(ctx, nose.x, nose.y, mx, my, nh, Math.max(1.8, nh * 0.38));
      }
      if (nose.v >= 0.2) {
        const headR = Math.max(jointRBase * 1.75, baseLimbHalf * 2.25);
        ctx.beginPath();
        ctx.arc(nose.x, nose.y, headR, 0, Math.PI * 2);
        ctx.fillStyle = GHOST_FILL_TRAINER;
        ctx.fill();
        ctx.strokeStyle = GHOST_OUTLINE_TRAINER;
        ctx.lineWidth = Math.max(2.2, Math.min(4, headR * 0.14));
        ctx.stroke();
      }
    }

    function drawGhost(W, H, now) {
      const cycle = GHOST_CYCLES[ghostExercise];
      if (!cycle || !cycle.length) return;

      const vw = video.videoWidth, vh = video.videoHeight;
      const scale   = Math.max(W / vw, H / vh);
      const offsetX = (W - vw * scale) / 2;
      const offsetY = (H - vh * scale) / 2;

      const n = cycle.length;
      const ph = ((ghostPhase % n) + n) % n;
      const i0 = Math.floor(ph) % n;
      const i1 = (i0 + 1) % n;
      const t = ph - Math.floor(ph);
      const frame = lerpLandmarks(cycle[i0], cycle[i1], t);

      if (ghostLayoutStage === 'fullscreen' && ghostIntroStartedMs > 0 &&
          now - ghostIntroStartedMs >= GHOST_INTRO_FULLSCREEN_MS) {
        ghostLayoutStage = 'transition';
        ghostTransitionStartMs = now;
      }

      const baseLimbHalf = Math.max(9, Math.min(W, H) * 0.0155);
      const jointRBase = baseLimbHalf * 1.12;
      const rects = ghostPanelRects(W, H);
      const padFull = 40;
      const padCorner = 12;

      if (ghostLayoutStage === 'fullscreen') {
        const r = rects.fullscreen;
        drawGhostInTrainerPanel(
          frame, vw, vh, scale, offsetX, offsetY, W, H, baseLimbHalf, jointRBase,
          r.x, r.y, r.w, r.h, padFull,
        );
      } else if (ghostLayoutStage === 'transition') {
        const elapsed = now - ghostTransitionStartMs;
        let u = easeInOutCubic(elapsed / GHOST_LAYOUT_TRANSITION_MS);
        if (elapsed >= GHOST_LAYOUT_TRANSITION_MS || u >= 1) {
          ghostLayoutStage = 'corner';
          u = 1;
        }
        const A = rects.fullscreen;
        const B = rects.corner;
        const rx = A.x + (B.x - A.x) * u;
        const ry = A.y + (B.y - A.y) * u;
        const rw = A.w + (B.w - A.w) * u;
        const rh = A.h + (B.h - A.h) * u;
        const innerPad = padFull + (padCorner - padFull) * u;
        drawGhostInTrainerPanel(
          frame, vw, vh, scale, offsetX, offsetY, W, H, baseLimbHalf, jointRBase,
          rx, ry, rw, rh, innerPad,
        );
      } else if (ghostLayoutStage === 'corner') {
        const r = rects.corner;
        drawGhostInTrainerPanel(
          frame, vw, vh, scale, offsetX, offsetY, W, H, baseLimbHalf, jointRBase,
          r.x, r.y, r.w, r.h, padCorner,
        );
      }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false
      });
      video.srcObject = stream;
      await new Promise(r => video.addEventListener('loadeddata', r, { once: true }));
      msg.textContent = '';
      loop();
    } catch (e) {
      msg.textContent = 'Camera error: ' + e.message;
    }

    function loop() {
      requestAnimationFrame(loop);
      if (video.readyState < 2) return;

      // Canvas tracks screen size, not raw video size.
      // DrawingUtils multiplies landmark.x by canvas.width, so keeping
      // canvas in screen pixels and passing screen-normalised landmarks
      // places joints exactly where the video pixels appear on screen.
      const W = window.innerWidth;
      const H = window.innerHeight;
      if (canvas.width  !== W) canvas.width  = W;
      if (canvas.height !== H) canvas.height = H;

      const now = performance.now();
      const dt = ghostLastRafNow ? Math.min(80, now - ghostLastRafNow) : 0;
      ghostLastRafNow = now;

      const cycle = GHOST_CYCLES[ghostExercise];
      const cycLen = cycle && cycle.length ? cycle.length : 0;
      if (cycLen > 0) {
        ghostPhase += dt / GHOST_MS_PER_KEYFRAME;
        while (ghostPhase >= cycLen) ghostPhase -= cycLen;
      }

      const newVideoFrame = video.currentTime !== lastTs;
      if (newVideoFrame) lastTs = video.currentTime;

      if (newVideoFrame) {
        const result = landmarker.detectForVideo(video, now);
        if (result.landmarks && result.landmarks.length > 0) {
          const lms = result.landmarks[0];
          const vw = video.videoWidth, vh = video.videoHeight;
          const scale = Math.max(W / vw, H / vh);
          const offsetX = (W - vw * scale) / 2;
          const offsetY = (H - vh * scale) / 2;
          lastAlignedLandmarks = lms.map(lm => ({
            ...lm,
            x: (lm.x * vw * scale + offsetX) / W,
            y: (lm.y * vh * scale + offsetY) / H,
          }));
          window.ReactNativeWebView?.postMessage(JSON.stringify({
            type: 'pose',
            landmarks: lastAlignedLandmarks,
          }));
        }
      }

      ctx.clearRect(0, 0, W, H);

      // Draw ghost every rAF (smooth interpolation); live skeleton uses last pose when video frame unchanged.
      drawGhost(W, H, now);

      if (lastAlignedLandmarks) {
        draw.drawConnectors(lastAlignedLandmarks, PoseLandmarker.POSE_CONNECTIONS,
          { color: '#00d4ff', lineWidth: 2.5 });
        draw.drawLandmarks(lastAlignedLandmarks,
          { color: '#00d4ff', fillColor: '#00d4ff', lineWidth: 1, radius: 4 });
      }
    }
  </script>
</body>
</html>
`;

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export const POSE_WEBVIEW_KEY = `pose-html-${hashString(POSE_HTML)}`;

export function buildGhostExerciseInjection(exercise: string | null | undefined): string {
  const ghostExercise = exercise ?? 'walking';
  return `try { window.__setGhostExercise && window.__setGhostExercise(${JSON.stringify(
    ghostExercise,
  )}); } catch (e) {} true;`;
}

/** Call when user starts a calibration rep recording — fullscreen trainer panel, then corner PiP. */
export function buildGhostRecordingLayoutInjection(exercise: string | null | undefined): string {
  const ex = exercise ?? 'walking';
  return `try {
    if (window.__setGhostExercise) window.__setGhostExercise(${JSON.stringify(ex)});
    if (window.__ghostStartRecordingLayout) window.__ghostStartRecordingLayout();
  } catch (e) {} true;`;
}
