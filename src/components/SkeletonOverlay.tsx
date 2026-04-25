/**
 * src/components/SkeletonOverlay.tsx — THE SKELETON DRAWN OVER THE CAMERA
 *
 * This component takes a set of 33 body landmarks and draws a stick-figure
 * skeleton on top of the camera feed — exactly like you see in sports-tracking
 * or motion-capture software.
 *
 * WHAT IT RENDERS:
 *   - Cyan lines ("bones") connecting pairs of joints
 *   - Cyan dots ("joints") at each visible landmark position
 *
 * HOW COORDINATES WORK:
 *   MediaPipe gives us x/y as fractions of the frame (0.0 to 1.0).
 *   This component receives the actual pixel width/height of the camera view,
 *   then multiplies:
 *     pixel_x = landmark.x × screenWidth
 *     pixel_y = landmark.y × screenHeight
 *
 * VISIBILITY FILTERING:
 *   Each landmark has a `visibility` score (0–1). If visibility < 0.5,
 *   the model isn't confident that joint is actually visible in the frame
 *   (e.g. a knee hidden behind a chair). We skip those joints and their
 *   connected bones so we don't draw misleading lines.
 *
 * WHY SVG (not Canvas or plain Views):
 *   SVG lets us draw arbitrary lines and circles with sub-pixel precision
 *   using simple declarative syntax. It's positioned absolutely on top of
 *   the camera view using `position: 'absolute'` so it doesn't take up
 *   any layout space — the camera shows through underneath.
 */

import React from 'react';
import Svg, { Circle, Line } from 'react-native-svg';
import { PoseFrame } from '../types';
import { SKELETON_CONNECTIONS } from '../engine/landmarks';

// ─────────────────────────────────────────────────────────────────────────────
// PROPS
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  /** The 33 landmarks from the latest pose frame. */
  pose:   PoseFrame;
  /** Pixel width of the camera view — used to convert landmark fractions to pixels. */
  width:  number;
  /** Pixel height of the camera view. */
  height: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * MIN_VISIBILITY — THRESHOLD FOR DRAWING A LANDMARK
 *
 * If a landmark's visibility score is below this number, we skip it.
 * 0.5 means "at least 50% confident this joint is visible in the frame".
 * Setting it lower (e.g. 0.2) draws more joints but with more noise.
 * Setting it higher (e.g. 0.8) draws fewer but more reliable joints.
 */
const MIN_VISIBILITY = 0.2;

// Visual style constants — all in one place for easy tweaking.
const BONE_COLOR    = '#00d4ff'; // cyan — matches the app's accent colour
const JOINT_COLOR   = '#00d4ff';
const BONE_WIDTH    = 2.5;       // line thickness in pixels
const JOINT_RADIUS  = 5;         // dot radius in pixels
const BONE_OPACITY  = 0.75;      // slightly transparent so camera shows through
const JOINT_OPACITY = 0.90;

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function SkeletonOverlay({ pose, width, height }: Props) {
  return (
    /**
     * The SVG canvas sits exactly on top of the camera view.
     * `position: 'absolute'` and top/left=0 ensures it covers the camera
     * precisely without pushing other elements around.
     * `pointerEvents="none"` lets touches pass through to elements below.
     */
    <Svg
      width={width}
      height={height}
      style={{ position: 'absolute', top: 0, left: 0 }}
      pointerEvents="none"
    >
      {/* ── BONES (drawn first, so joint dots render on top of them) ──────── */}
      {SKELETON_CONNECTIONS.map(([indexA, indexB]) => {
        const landmarkA = pose[indexA];
        const landmarkB = pose[indexB];

        // Skip if either landmark doesn't exist in the frame.
        if (!landmarkA || !landmarkB) return null;

        // Skip if either end of the bone is not confidently visible.
        if ((landmarkA.visibility ?? 1) < MIN_VISIBILITY) return null;
        if ((landmarkB.visibility ?? 1) < MIN_VISIBILITY) return null;

        // Convert the 0–1 fractions into actual pixel positions.
        const x1 = landmarkA.x * width;
        const y1 = landmarkA.y * height;
        const x2 = landmarkB.x * width;
        const y2 = landmarkB.y * height;

        return (
          <Line
            key={`bone-${indexA}-${indexB}`}
            x1={x1} y1={y1}
            x2={x2} y2={y2}
            stroke={BONE_COLOR}
            strokeWidth={BONE_WIDTH}
            strokeOpacity={BONE_OPACITY}
            strokeLinecap="round" // round ends look cleaner than square
          />
        );
      })}

      {/* ── JOINTS (drawn on top of bones so they're clearly visible) ──────── */}
      {pose.map((landmark, index) => {
        // Skip low-confidence joints — don't draw misleading dots.
        if ((landmark.visibility ?? 1) < MIN_VISIBILITY) return null;

        return (
          <Circle
            key={`joint-${index}`}
            cx={landmark.x * width}   // centre x in pixels
            cy={landmark.y * height}  // centre y in pixels
            r={JOINT_RADIUS}
            fill={JOINT_COLOR}
            fillOpacity={JOINT_OPACITY}
          />
        );
      })}
    </Svg>
  );
}
