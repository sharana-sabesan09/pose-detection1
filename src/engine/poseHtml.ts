/**
 * src/engine/poseHtml.ts — MEDIAPIPE POSE HTML FOR WEBVIEW
 *
 * This string is loaded into a React Native WebView. Inside that WebView the
 * browser engine runs — which means WebAssembly, WebGL GPU acceleration, and
 * the full MediaPipe Tasks Vision JavaScript SDK all work exactly like they do
 * in Chrome or Safari.
 *
 * WHAT HAPPENS INSIDE THE WEBVIEW:
 *   1. MediaPipe Tasks Vision SDK loads from the jsDelivr CDN (~1MB WASM)
 *   2. PoseLandmarker model downloads from Google Storage (~3MB, first run only)
 *   3. getUserMedia() starts the back camera
 *   4. Every animation frame (~30fps), detectForVideo() runs on the live video
 *   5. DrawingUtils draws the cyan skeleton directly onto a canvas
 *   6. window.ReactNativeWebView.postMessage() sends 33 landmark objects to RN
 *      so the score detectors (Steps 4-7) can do their work natively
 *
 * WHY THIS IS FASTER THAN TF.JS ON THE JS THREAD:
 *   TF.js with the CPU backend runs inference in Hermes JS — single-threaded,
 *   no SIMD, no GPU. MoveNet Lightning took ~10 seconds per frame.
 *   MediaPipe WASM runs on a dedicated thread with SIMD and WebGL GPU shaders.
 *   MediaPipe Pose Lite gives ~30fps on any modern iPhone.
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
             background: rgba(0,0,0,0.5); padding: 4px 8px; border-radius: 4px; }
  </style>
</head>
<body>
  <video id="v" autoplay playsinline muted></video>
  <canvas id="c"></canvas>
  <div id="msg">Loading MediaPipe…</div>

  <script type="module">
    import { PoseLandmarker, FilesetResolver, DrawingUtils }
      from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm';

    const video  = document.getElementById('v');
    const canvas = document.getElementById('c');
    const msg    = document.getElementById('msg');
    const ctx    = canvas.getContext('2d');

    // ── 1. Load MediaPipe WASM + model ──────────────────────────────────────
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

    // ── 2. Start the back camera ─────────────────────────────────────────────
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

    // ── 3. Detection + draw loop ─────────────────────────────────────────────
    const draw  = new DrawingUtils(ctx);
    let lastTs  = -1;

    function loop() {
      requestAnimationFrame(loop);

      if (video.readyState < 2) return;

      // Sync canvas size to video dimensions every frame (handles rotation changes)
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width  = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      if (video.currentTime === lastTs) return;
      lastTs = video.currentTime;

      const result = landmarker.detectForVideo(video, performance.now());
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (result.landmarks && result.landmarks.length > 0) {
        const lms = result.landmarks[0];

        // Draw cyan skeleton using MediaPipe's built-in DrawingUtils
        draw.drawConnectors(lms, PoseLandmarker.POSE_CONNECTIONS,
          { color: '#00d4ff', lineWidth: 2.5 });
        draw.drawLandmarks(lms,
          { color: '#00d4ff', fillColor: '#00d4ff', lineWidth: 1, radius: 4 });

        // Send landmarks to React Native for score computation
        window.ReactNativeWebView?.postMessage(JSON.stringify({
          type: 'pose',
          landmarks: lms   // 33 objects: { x, y, z, visibility }
        }));
      }
    }
  </script>
</body>
</html>
`;
