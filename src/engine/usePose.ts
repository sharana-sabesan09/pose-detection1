/**
 * src/engine/usePose.ts — POSE DETECTION HOOK (TF.js + MoveNet)
 *
 * HOW IT WORKS IN ONE PARAGRAPH:
 *   Every 100ms this hook takes a photo with the camera, decodes it from JPEG
 *   to raw pixels using jpeg-js, shrinks it down to 192×192 using TensorFlow,
 *   and runs Google's MoveNet model which returns 17 body keypoints in ~30ms.
 *   Those 17 keypoints are mapped into our 33-slot PoseFrame format so the
 *   rest of the app (SkeletonOverlay, detectors, scores) works unchanged.
 *   Zero preprocessing code needed — MoveNet handles everything internally.
 *
 * WHY MOVENET INSTEAD OF THE ZETIC APPROACH:
 *   The ZETIC / MediaPipe Pose path required us to manually resize → normalize
 *   → flatten the image into a float array, then parse 132 raw floats back into
 *   landmarks. MoveNet's TF.js API does all of that internally.
 *   You pass it a tensor, you get back named keypoints. Done.
 *
 * WHY MoveNet LIGHTNING (not BlazePose):
 *   BlazePose gives 33 landmarks but requires GPU (WebGL backend), which isn't
 *   available in React Native without Expo's GL layer.
 *   MoveNet Lightning runs on the CPU backend, gives 17 landmarks, and is fast
 *   enough for 10fps on a real iPhone — exactly what we need.
 *
 * THE 17 → 33 MAPPING:
 *   Our PoseFrame type has 33 slots (MediaPipe indexing). MoveNet gives 17
 *   keypoints in COCO ordering. MOVENET_TO_MEDIAPIPE maps each MoveNet index
 *   to the correct MediaPipe slot, so SkeletonOverlay and all detectors
 *   continue using pose[LM.LEFT_HIP] etc. with no changes needed.
 *
 * STATUS VALUES:
 *   'initialising' → TF.js loading + MoveNet model downloading (~5s first run)
 *   'ready'        → model loaded, real keypoints every 100ms
 *   'error'        → initialisation failed (check errorMessage)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import * as tf from '@tensorflow/tfjs-core';
import { setPlatform } from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-cpu';
import * as poseDetection from '@tensorflow-models/pose-detection';
import { decode as decodeJpeg } from 'jpeg-js';
import { PoseFrame } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type PoseStatus = 'initialising' | 'ready' | 'error';

interface CameraHandle {
  takePhoto(): Promise<{ path: string }>;
}

export interface UsePoseReturn {
  cameraRef:       React.RefObject<CameraHandle | null>;
  onCameraStarted: () => void;
  pose:            PoseFrame | null;
  status:          PoseStatus;
  errorMessage:    string | null;
  isMock:          boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// KEYPOINT MAPPING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * MOVENET_TO_MEDIAPIPE
 *
 * MoveNet returns 17 keypoints in COCO order (0=nose, 5=left_shoulder, etc.).
 * Our PoseFrame has 33 slots in MediaPipe order (0=nose, 11=left_shoulder, etc.).
 *
 * This array says: "MoveNet keypoint at index i goes into MediaPipe slot MOVENET_TO_MEDIAPIPE[i]"
 *
 * MoveNet → MediaPipe
 *   0  nose          →  0
 *   1  left_eye      →  2
 *   2  right_eye     →  5
 *   3  left_ear      →  7
 *   4  right_ear     →  8
 *   5  left_shoulder → 11
 *   6  right_shoulder→ 12
 *   7  left_elbow    → 13
 *   8  right_elbow   → 14
 *   9  left_wrist    → 15
 *  10  right_wrist   → 16
 *  11  left_hip      → 23
 *  12  right_hip     → 24
 *  13  left_knee     → 25
 *  14  right_knee    → 26
 *  15  left_ankle    → 27
 *  16  right_ankle   → 28
 *
 * Slots not covered (heels 29/30, etc.) stay at visibility=0 so the
 * SkeletonOverlay skips them automatically.
 */
const MOVENET_TO_MEDIAPIPE = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

// MoveNet Lightning input size. The model was trained on 192×192.
const MODEL_INPUT_SIZE = 192;

// How often to capture a frame. 100ms = 10fps.
const FRAME_INTERVAL_MS = 100;

// ─────────────────────────────────────────────────────────────────────────────
// THE HOOK
// ─────────────────────────────────────────────────────────────────────────────

export function usePose(): UsePoseReturn {
  const cameraRef = useRef<CameraHandle>(null);
  const [pose, setPose] = useState<PoseFrame | null>(null);
  const [status, setStatus] = useState<PoseStatus>('initialising');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Prevents two inference passes from overlapping if one takes > 100ms.
  const isProcessing = useRef(false);

  // Set to true by onCameraStarted() once VisionCamera fires its ready event.
  // Prevents takePhoto() being called before the lens is open.
  const cameraReady = useRef(false);

  // Holds the loaded MoveNet detector. Null until initialisation completes.
  const detectorRef = useRef<poseDetection.PoseDetector | null>(null);

  // The screen passes this to <Camera onStarted={onCameraStarted} />.
  const onCameraStarted = useCallback(() => {
    cameraReady.current = true;
  }, []);

  // ── EFFECT 1: Initialise TF.js + load MoveNet Lightning ───────────────────
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        /**
         * tf.ready() registers the CPU backend and waits for it to be usable.
         * On first call it also primes some internal state — always await this
         * before creating any tensors or models.
         */
        // Tell TF.js-core how to make network requests in React Native.
        // Without this, env().platform is undefined and model downloads crash.
        setPlatform('react-native', {
          fetch:        (url: string, init?: RequestInit) => fetch(url, init),
          now:          () => performance.now(),
          encode:       (text: string, _enc: string) => new TextEncoder().encode(text),
          decode:       (bytes: Uint8Array, enc: string) => new TextDecoder(enc).decode(bytes),
          isTypedArray: (a: unknown): a is Uint8Array | Uint8ClampedArray | Int32Array | Float32Array =>
            a instanceof Uint8Array || a instanceof Uint8ClampedArray ||
            a instanceof Int32Array || a instanceof Float32Array,
        });

        await tf.ready();

        /**
         * createDetector() downloads MoveNet Lightning from TF Hub (~3MB) on
         * the very first run. Subsequent runs use the cached model.
         * enableSmoothing: true applies a Kalman filter across frames, which
         * removes the jitter you'd otherwise see on fast movements.
         */
        const detector = await poseDetection.createDetector(
          poseDetection.SupportedModels.MoveNet,
          {
            modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
            enableSmoothing: true,
          }
        );

        if (!cancelled) {
          detectorRef.current = detector;
          setStatus('ready');
        }
      } catch (e) {
        if (!cancelled) {
          setErrorMessage((e as Error).message);
          setStatus('error');
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      // Release the model from memory when the screen unmounts.
      detectorRef.current?.dispose?.();
    };
  }, []);

  // ── EFFECT 2: Frame capture + inference loop ───────────────────────────────
  useEffect(() => {
    if (status !== 'ready') return;

    const interval = setInterval(async () => {
      if (isProcessing.current)       return; // previous frame still running
      if (!cameraRef.current)         return; // no camera mounted
      if (!cameraReady.current)       return; // camera not yet initialised
      if (!detectorRef.current)       return; // model not yet loaded

      isProcessing.current = true;

      // imageTensor is declared outside try so we can safely dispose in finally
      // even if an error is thrown partway through tensor creation.
      let imageTensor: tf.Tensor3D | null = null;

      try {
        // ── Step 1: Capture a JPEG from the camera ───────────────────────────
        const photo = await cameraRef.current.takePhoto();

        // ── Step 2: Read the JPEG file into raw bytes ────────────────────────
        // `fetch` with a file:// URL works in React Native and is the only
        // way to read a file path without a native module like react-native-fs.
        const response   = await fetch('file://' + photo.path);
        const buffer     = await response.arrayBuffer();

        // ── Step 3: Decode JPEG bytes → RGBA pixel array ─────────────────────
        // jpeg-js is a pure-JS decoder — no native code, works on Hermes.
        // Output: { data: Uint8Array of [R,G,B,A,R,G,B,A,...], width, height }
        const { data: rgba, width, height } = decodeJpeg(
          new Uint8Array(buffer),
          { useTArray: true }       // useTArray: return Uint8Array, not Buffer
        );

        // ── Step 4: RGBA → RGB ────────────────────────────────────────────────
        // TF.js expects 3 channels (RGB). Drop every 4th byte (Alpha channel).
        const rgb = new Uint8Array(width * height * 3);
        for (let i = 0; i < width * height; i++) {
          rgb[i * 3]     = rgba[i * 4];     // R
          rgb[i * 3 + 1] = rgba[i * 4 + 1]; // G
          rgb[i * 3 + 2] = rgba[i * 4 + 2]; // B
        }

        // ── Step 5: Create tensor + resize to 192×192 ────────────────────────
        // tf.tidy() automatically disposes every tensor created inside it
        // except the one that is returned. This avoids the subtle bug where
        // tf.squeeze() returns a view that shares memory with resizedBig —
        // if we disposed resizedBig manually, the squeezed view could be
        // invalidated before estimatePoses reads it.
        // iPhone stores JPEG pixels in landscape orientation regardless of how
        // the phone is held. jpeg-js decodes pixels as-is, ignoring the EXIF
        // rotation tag, so we get a sideways image. Rotate 90° CW to make the
        // person appear upright before feeding to MoveNet.
        // (90° CW = flip rows then transpose axes 0↔1)
        const full = tf.tensor3d(rgb, [height, width, 3], 'int32');
        imageTensor = tf.tidy(() => {
          const upright   = tf.transpose(tf.reverse(full, [0]), [1, 0, 2]) as tf.Tensor3D;
          const expanded  = tf.expandDims(upright, 0) as tf.Tensor4D;
          const resized4d = tf.image.resizeBilinear(expanded, [MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);
          return tf.squeeze(resized4d) as tf.Tensor3D;
        });
        full.dispose();

        // ── Step 6: Run MoveNet ───────────────────────────────────────────────
        // estimatePoses returns an array of detected people. For SINGLEPOSE
        // models there is always at most 1 person.
        // Keypoint coords are in pixels relative to the 192×192 input.
        const poses = await detectorRef.current.estimatePoses(imageTensor);

        if (poses.length > 0) {
          const kp = poses[0].keypoints;
          const summary = kp.map(k => `${k.name}:${k.score?.toFixed(2)}`).join(' ');
          console.log('[usePose]', summary);
          setPose(keypointsToFrame(kp));
        } else {
          console.log('[usePose] no poses detected');
        }

      } catch (e) {
        // A single bad frame doesn't crash the app — the detectors use
        // rolling windows so one missing frame is harmless.
        console.warn('[usePose] Frame skipped:', (e as Error).message);
      } finally {
        imageTensor?.dispose(); // always free GPU/CPU memory
        isProcessing.current = false;
      }
    }, FRAME_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [status]);

  return {
    cameraRef,
    onCameraStarted,
    pose,
    status,
    errorMessage,
    isMock: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * keypointsToFrame — MAPS MOVENET'S 17 KEYPOINTS INTO A 33-SLOT POSEFRAME
 *
 * Starts with 33 invisible placeholder landmarks, then writes each MoveNet
 * keypoint into the correct MediaPipe slot using MOVENET_TO_MEDIAPIPE.
 *
 * Keypoint x/y come back as pixels in [0, 192). Dividing by MODEL_INPUT_SIZE
 * normalises them to [0, 1] fractions which is what SkeletonOverlay expects.
 * The score field (0–1) maps directly to our visibility field.
 */
function keypointsToFrame(keypoints: poseDetection.Keypoint[]): PoseFrame {
  const frame: PoseFrame = Array(33).fill(null).map(() => ({
    x: 0, y: 0, z: 0, visibility: 0,
  }));

  keypoints.forEach((kp, moveNetIdx) => {
    const mpIdx = MOVENET_TO_MEDIAPIPE[moveNetIdx];
    if (mpIdx === undefined) return;

    frame[mpIdx] = {
      x:          kp.x / MODEL_INPUT_SIZE,
      y:          kp.y / MODEL_INPUT_SIZE,
      z:          0,
      visibility: kp.score ?? 0,
    };
  });

  return frame;
}
