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

      const result = landmarker.detectForVideo(video, performance.now());
      ctx.clearRect(0, 0, W, H);

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
