/**
 * GhostSkeletonOverlay — reference skeleton drawn over the live camera feed.
 *
 * Two skeletons are rendered on the same SVG canvas:
 *   1. Ghost (reference) — dashed white lines / white dots, coloured by
 *      deviation from the user's live pose:
 *        white  → on track (dist < THRESH_WARN)
 *        orange → mild deviation (THRESH_WARN ≤ dist < THRESH_BAD)
 *        red    → large deviation (dist ≥ THRESH_BAD)
 *   2. Live (user)  — solid cyan, same as SkeletonOverlay.
 *
 * Coordinates are MediaPipe-normalised 0–1; multiplied by width/height to get pixels.
 */

import React from 'react';
import Svg, { Circle, Line } from 'react-native-svg';
import { PoseFrame } from '../types/index';
import { SKELETON_CONNECTIONS } from '../engine/landmarks';

interface Props {
  refFrame:  PoseFrame;       // hardcoded reference pose
  liveFrame: PoseFrame | null; // current MediaPipe pose (null until first frame)
  width:     number;
  height:    number;
}

// ── Deviation thresholds (normalised 0–1 screen space) ────────────────────────
const THRESH_WARN = 0.08;
const THRESH_BAD  = 0.15;
const MIN_VIS     = 0.2;

// ── Colours ───────────────────────────────────────────────────────────────────
const GHOST_BASE = 'rgba(255,255,255,0.40)';
const COLOR_WARN = '#ff9800';
const COLOR_BAD  = '#f44336';
const LIVE_COLOR = '#00d4ff';

function deviationColor(
  ref: { x: number; y: number },
  live: { x: number; y: number; visibility?: number } | undefined,
): string {
  if (!live || (live.visibility ?? 1) < MIN_VIS) return GHOST_BASE;
  const d = Math.sqrt((ref.x - live.x) ** 2 + (ref.y - live.y) ** 2);
  if (d >= THRESH_BAD)  return COLOR_BAD;
  if (d >= THRESH_WARN) return COLOR_WARN;
  return GHOST_BASE;
}

function boneColor(
  idxA: number, idxB: number,
  ref: PoseFrame, live: PoseFrame | null,
): string {
  const cA = deviationColor(ref[idxA], live?.[idxA]);
  const cB = deviationColor(ref[idxB], live?.[idxB]);
  if (cA === COLOR_BAD  || cB === COLOR_BAD)  return COLOR_BAD;
  if (cA === COLOR_WARN || cB === COLOR_WARN) return COLOR_WARN;
  return GHOST_BASE;
}

export default function GhostSkeletonOverlay({ refFrame, liveFrame, width, height }: Props) {
  return (
    <Svg
      width={width}
      height={height}
      style={{ position: 'absolute', top: 0, left: 0 }}
      pointerEvents="none"
    >
      {/* ── Reference (ghost) skeleton ──────────────────────────────────── */}
      {SKELETON_CONNECTIONS.map(([a, b]) => {
        const lmA = refFrame[a];
        const lmB = refFrame[b];
        if (!lmA || !lmB) return null;
        return (
          <Line
            key={`ref-bone-${a}-${b}`}
            x1={lmA.x * width}  y1={lmA.y * height}
            x2={lmB.x * width}  y2={lmB.y * height}
            stroke={boneColor(a, b, refFrame, liveFrame)}
            strokeWidth={2}
            strokeOpacity={0.7}
            strokeLinecap="round"
            strokeDasharray="5 4"
          />
        );
      })}
      {refFrame.map((lm, i) => lm ? (
        <Circle
          key={`ref-joint-${i}`}
          cx={lm.x * width}  cy={lm.y * height}
          r={4}
          fill={deviationColor(lm, liveFrame?.[i])}
          fillOpacity={0.65}
        />
      ) : null)}

      {/* ── Live (user) skeleton ────────────────────────────────────────── */}
      {liveFrame && SKELETON_CONNECTIONS.map(([a, b]) => {
        const lmA = liveFrame[a];
        const lmB = liveFrame[b];
        if (!lmA || !lmB) return null;
        if ((lmA.visibility ?? 1) < MIN_VIS || (lmB.visibility ?? 1) < MIN_VIS) return null;
        return (
          <Line
            key={`live-bone-${a}-${b}`}
            x1={lmA.x * width}  y1={lmA.y * height}
            x2={lmB.x * width}  y2={lmB.y * height}
            stroke={LIVE_COLOR}
            strokeWidth={2.5}
            strokeOpacity={0.85}
            strokeLinecap="round"
          />
        );
      })}
      {liveFrame && liveFrame.map((lm, i) => {
        if (!lm || (lm.visibility ?? 1) < MIN_VIS) return null;
        return (
          <Circle
            key={`live-joint-${i}`}
            cx={lm.x * width}  cy={lm.y * height}
            r={5}
            fill={LIVE_COLOR}
            fillOpacity={0.9}
          />
        );
      })}
    </Svg>
  );
}
