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
    const GHOST_CONNECTIONS = [
      [11,12],[11,23],[12,24],[23,24],
      [23,25],[25,27],[27,29],[24,26],[26,28],[28,30],
      [11,13],[13,15],[12,14],[14,16],
    ];

    const lrPartner = (() => {
      const p = Array.from({ length: 33 }, (_, i) => i);
      const swap = (a, b) => { const t = p[a]; p[a] = p[b]; p[b] = t; };
      swap(1,4); swap(2,5); swap(3,6); swap(7,8); swap(9,10);
      swap(11,12); swap(13,14); swap(15,16); swap(17,18); swap(19,20);
      swap(21,22); swap(23,24); swap(25,26); swap(27,28); swap(29,30); swap(31,32);
      return p;
    })();

    let ghostExercise = 'leftSls';
    let ghostMirror = false;
    let ghostRefIdx = 0;
    let lastRefTs = 0;

    window.__setGhostExercise = (ex) => {
      ghostExercise = ex || 'leftSls';
      ghostMirror = ghostExercise === 'rightSls' || ghostExercise === 'rightLsd';
      ghostRefIdx = 0;
    };

    function mirrorLandmarks(frame) {
      const out = new Array(33);
      for (let i = 0; i < 33; i++) {
        const src = frame[lrPartner[i]];
        out[i] = { x: 1 - src.x, y: src.y, z: src.z, v: src.v };
      }
      return out;
    }

    function alignGhostLm(lm, vw, vh, scale, ox, oy, W, H) {
      return {
        x: (lm.x * vw * scale + ox) / W,
        y: (lm.y * vh * scale + oy) / H,
        z: lm.z,
        v: lm.v,
      };
    }

    function drawGhost(W, H) {
      const cycle = GHOST_CYCLES[ghostExercise];
      if (!cycle || !cycle.length) return;

      const vw = video.videoWidth, vh = video.videoHeight;
      const scale   = Math.max(W / vw, H / vh);
      const offsetX = (W - vw * scale) / 2;
      const offsetY = (H - vh * scale) / 2;

      const raw = cycle[ghostRefIdx % cycle.length];
      const frame = ghostMirror ? mirrorLandmarks(raw) : raw;

      ctx.save();
      ctx.globalAlpha = 0.42;
      ctx.strokeStyle = '#3cdc3c';
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.fillStyle = '#3cdc3c';
      for (const [a, b] of GHOST_CONNECTIONS) {
        const la = alignGhostLm(frame[a], vw, vh, scale, offsetX, offsetY, W, H);
        const lb = alignGhostLm(frame[b], vw, vh, scale, offsetX, offsetY, W, H);
        if (la.v < 0.2 || lb.v < 0.2) continue;
        ctx.beginPath();
        ctx.moveTo(la.x * W, la.y * H);
        ctx.lineTo(lb.x * W, lb.y * H);
        ctx.stroke();
      }
      for (const lm of frame) {
        const p = alignGhostLm(lm, vw, vh, scale, offsetX, offsetY, W, H);
        if (p.v < 0.2) continue;
        ctx.beginPath();
        ctx.arc(p.x * W, p.y * H, 4, 0, Math.PI * 2);
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

      // Advance reference frame at ~30 fps (one step per ~33ms of video time)
      const now = performance.now();
      if (now - lastRefTs >= 33) {
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
