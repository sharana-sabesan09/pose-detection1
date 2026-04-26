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

export const POSE_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100vw; height: 100vh; overflow: hidden; background: #000; }
    video  { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; }
    canvas { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }
    #msg   { position: absolute; top: 12px; left: 12px; color: #fff; font: 12px monospace;
             background: rgba(0,0,0,0.6); padding: 4px 8px; border-radius: 4px; }
  </style>
</head>
<body>
  <video id="v" autoplay playsinline muted></video>
  <canvas id="c"></canvas>
  <div id="msg">Loading MediaPipe…</div>

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

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false
      });
      video.srcObject = stream;
      await new Promise(r => video.addEventListener('loadeddata', r, { once: true }));
      msg.textContent = '';
      loop();
    } catch (e) {
      msg.textContent = 'Camera error: ' + e.message;
    }

    const draw = new DrawingUtils(ctx);
    let lastTs = -1;

    // ── Reference ghost skeleton (single-leg squat cycle) ──────────────────
    const _C = (x, y, v = 0.0) => ({ x, y, v });
    const STAND = {
       0: _C(0.50,0.10,1), 7: _C(0.47,0.11,1), 8: _C(0.53,0.11,1),
      11: _C(0.43,0.22,1),12: _C(0.57,0.22,1),13: _C(0.46,0.30,1),
      14: _C(0.54,0.30,1),15: _C(0.495,0.36,1),16: _C(0.505,0.36,1),
      23: _C(0.47,0.55,1),24: _C(0.54,0.56,1),25: _C(0.48,0.72,1),
      26: _C(0.54,0.47,1),27: _C(0.49,0.88,1),28: _C(0.54,0.56,1),
      29: _C(0.48,0.91,1),30: _C(0.55,0.58,1),
    };
    const BOTTOM = {
       0: _C(0.50,0.12,1), 7: _C(0.47,0.13,1), 8: _C(0.53,0.13,1),
      11: _C(0.43,0.24,1),12: _C(0.57,0.24,1),13: _C(0.46,0.32,1),
      14: _C(0.54,0.32,1),15: _C(0.495,0.40,1),16: _C(0.505,0.40,1),
      23: _C(0.48,0.60,1),24: _C(0.54,0.58,1),25: _C(0.51,0.74,1),
      26: _C(0.54,0.48,1),27: _C(0.50,0.88,1),28: _C(0.54,0.57,1),
      29: _C(0.49,0.91,1),30: _C(0.55,0.59,1),
    };
    const REF_FRAMES = 60;
    const refCycle = Array.from({ length: REF_FRAMES }, (_, i) => {
      const t = (1 - Math.cos((i / (REF_FRAMES - 1)) * Math.PI)) / 2;
      return Array.from({ length: 33 }, (__, idx) => {
        const s = STAND[idx]  || _C(0.5, 0.5, 0);
        const b = BOTTOM[idx] || _C(0.5, 0.5, 0);
        return { x: s.x + (b.x - s.x) * t, y: s.y + (b.y - s.y) * t, v: s.v };
      });
    });
    const GHOST_CONNECTIONS = [
      [11,12],[11,23],[12,24],[23,24],
      [23,25],[25,27],[27,29],[24,26],[26,28],[28,30],
      [11,13],[13,15],[12,14],[14,16],
    ];
    let refIdx = 0;
    let lastRefTs = 0;

    function drawGhost(W, H) {
      const frame = refCycle[refIdx];
      ctx.save();
      ctx.globalAlpha = 0.42;
      ctx.strokeStyle = '#3cdc3c';
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.fillStyle = '#3cdc3c';
      for (const [a, b] of GHOST_CONNECTIONS) {
        const la = frame[a], lb = frame[b];
        if (la.v < 0.2 || lb.v < 0.2) continue;
        ctx.beginPath();
        ctx.moveTo(la.x * W, la.y * H);
        ctx.lineTo(lb.x * W, lb.y * H);
        ctx.stroke();
      }
      for (const lm of frame) {
        if (lm.v < 0.2) continue;
        ctx.beginPath();
        ctx.arc(lm.x * W, lm.y * H, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
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
        refIdx = (refIdx + 1) % REF_FRAMES;
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
