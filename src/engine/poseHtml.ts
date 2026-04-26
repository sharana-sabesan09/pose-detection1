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
    /** Keyframe cadence through the subsampled cycle (higher = easier to follow). */
    const GHOST_MS_PER_KEYFRAME = 285;
    /** Shift ghost horizontally (fraction of width) so user and silhouette overlap less. */
    const GHOST_OFFSET_X_FRAC = 0.072;
    /** rgba alpha: limbs more see-through, joints/head slightly more solid (wider translucency range). */
    const GHOST_LIMB_ALPHA = 0.22;
    const GHOST_JOINT_ALPHA = 0.58;
    const GHOST_HEAD_ALPHA = 0.5;
    const GHOST_CONNECTIONS = [
      [11,12],[11,23],[12,24],[23,24],
      [23,25],[25,27],[27,29],[24,26],[26,28],[28,30],
      [11,13],[13,15],[12,14],[14,16],
    ];

    // RN injects the current exercise after the page loads. Default to hidden so
    // the screen never flashes an outdated calibration ghost on boot/remount.
    let ghostExercise = 'walking';
    let ghostRefIdx = 0;
    let lastRefTs = 0;

    window.__setGhostExercise = (ex) => {
      ghostExercise = ex || 'walking';
      ghostRefIdx = 0;
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

    /** Filled limb “tube” between two screen points (silhouette, not stick lines). */
    function fillLimbCapsule(ctx, ax, ay, bx, by, halfW) {
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
      ctx.fill();
    }

    function drawGhost(W, H) {
      const cycle = GHOST_CYCLES[ghostExercise];
      if (!cycle || !cycle.length) return;

      const vw = video.videoWidth, vh = video.videoHeight;
      const scale   = Math.max(W / vw, H / vh);
      const offsetX = (W - vw * scale) / 2;
      const offsetY = (H - vh * scale) / 2;

      const frame = cycle[ghostRefIdx % cycle.length];

      const halfW = Math.max(12, Math.min(W, H) * 0.02);
      const jointR = halfW * 1.15;

      ctx.save();
      ctx.translate(W * GHOST_OFFSET_X_FRAC, 0);

      for (const [a, b] of GHOST_CONNECTIONS) {
        const pa = ghostPx(frame[a], vw, vh, scale, offsetX, offsetY, W, H);
        const pb = ghostPx(frame[b], vw, vh, scale, offsetX, offsetY, W, H);
        if (pa.v < 0.2 || pb.v < 0.2) continue;
        ctx.fillStyle = 'rgba(46,168,74,' + GHOST_LIMB_ALPHA + ')';
        fillLimbCapsule(ctx, pa.x, pa.y, pb.x, pb.y, halfW);
      }

      // Rounded joints so capsules read as one soft silhouette
      const jointIdx = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
      ctx.fillStyle = 'rgba(46,168,74,' + GHOST_JOINT_ALPHA + ')';
      for (const i of jointIdx) {
        const p = ghostPx(frame[i], vw, vh, scale, offsetX, offsetY, W, H);
        if (p.v < 0.2) continue;
        ctx.beginPath();
        ctx.arc(p.x, p.y, jointR, 0, Math.PI * 2);
        ctx.fill();
      }

      // Light head blob (nose) so the figure reads as a person, not headless
      const nose = ghostPx(frame[0], vw, vh, scale, offsetX, offsetY, W, H);
      if (nose.v >= 0.2) {
        ctx.fillStyle = 'rgba(46,168,74,' + GHOST_HEAD_ALPHA + ')';
        ctx.beginPath();
        ctx.arc(nose.x, nose.y, halfW * 1.35, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
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

      if (video.currentTime === lastTs) return;
      lastTs = video.currentTime;

      // Advance ghost keyframes slowly (see GHOST_MS_PER_KEYFRAME)
      const now = performance.now();
      if (now - lastRefTs >= GHOST_MS_PER_KEYFRAME) {
        const cycle = GHOST_CYCLES[ghostExercise];
        const n = cycle && cycle.length ? cycle.length : 1;
        ghostRefIdx = (ghostRefIdx + 1) % n;
        lastRefTs = now;
      }

      const result = landmarker.detectForVideo(video, performance.now());
      ctx.clearRect(0, 0, W, H);

      // Draw ghost reference first (behind live skeleton)
      drawGhost(W, H);

      if (result.landmarks && result.landmarks.length > 0) {
        const lms = result.landmarks[0];

        // object-fit:cover scale: how much the video is zoomed to fill the screen
        const vw = video.videoWidth, vh = video.videoHeight;
        const scale   = Math.max(W / vw, H / vh);
        const offsetX = (W - vw * scale) / 2;
        const offsetY = (H - vh * scale) / 2;

        // Re-normalise from raw video [0,1] → screen [0,1]
        const aligned = lms.map(lm => ({
          ...lm,
          x: (lm.x * vw * scale + offsetX) / W,
          y: (lm.y * vh * scale + offsetY) / H,
        }));

        draw.drawConnectors(aligned, PoseLandmarker.POSE_CONNECTIONS,
          { color: '#00d4ff', lineWidth: 2.5 });
        draw.drawLandmarks(aligned,
          { color: '#00d4ff', fillColor: '#00d4ff', lineWidth: 1, radius: 4 });

        window.ReactNativeWebView?.postMessage(JSON.stringify({
          type: 'pose',
          landmarks: aligned
        }));
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
