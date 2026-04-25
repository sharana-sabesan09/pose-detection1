/**
 * src/components/ScoreDashboard.tsx — THE LIVE RISK SCORE DISPLAY
 *
 * This component shows five coloured score boxes at the bottom of the session
 * screen, updating in real time as the detectors process each camera frame.
 *
 * LAYOUT (portrait phone):
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │  ┌───────────────────────────────────────────────┐  │
 *   │  │  OVERALL FALL RISK          82  ← large box   │  │
 *   │  └───────────────────────────────────────────────┘  │
 *   │  ┌──────────┐ ┌──────────┐ ┌──────────┐            │
 *   │  │ Balance  │ │Transition│ │  Gait    │            │
 *   │  │Stability │ │ Safety   │ │Regularity│            │
 *   │  │   76     │ │   91     │ │   58     │            │
 *   │  └──────────┘ └──────────┘ └──────────┘            │
 *   │  ┌────────────────────────┐                        │
 *   │  │    Lateral Sway  71    │                        │
 *   │  └────────────────────────┘                        │
 *   └─────────────────────────────────────────────────────┘
 *
 * COLOUR CODING (per PRD Step 5):
 *   75–100 → Green  #4caf50  "Low risk, safe to continue"
 *   50–74  → Yellow #f0a500  "Moderate risk, proceed with caution"
 *   25–49  → Orange #ff6d00  "High risk, consider stopping"
 *   0–24   → Red    #f44336  "Critical, stop immediately"
 *
 * INACTIVE SCORES:
 *   Scores from modes that are NOT currently active are shown at 40% opacity
 *   with their last known value. They do NOT reset to zero.
 *   (Example: if you're in Walking mode, Balance Stability dims but keeps
 *   its last value from when you were in Standing mode.)
 *
 * PROPS:
 *   scores       — the five live RiskScores
 *   mode         — current session mode (determines which boxes are active)
 *   initialized  — false until we have enough data; shows "—" instead of 0
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { RiskScores, SessionMode } from '../types';
import { scoreColor, scoreLabel } from '../engine/scoreAggregator';

// ─────────────────────────────────────────────────────────────────────────────
// PROPS
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  scores:      RiskScores;
  mode:        SessionMode;
  initialized: boolean;  // true once the first real landmark frame has arrived
}

// ─────────────────────────────────────────────────────────────────────────────
// WHICH SCORES ARE ACTIVE IN EACH MODE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Each mode activates specific detectors → specific scores.
 * Inactive scores are dimmed (but still visible with last value).
 */
const ACTIVE_SCORES: Record<SessionMode, (keyof RiskScores)[]> = {
  standing:   ['balanceStability', 'overallFallRisk'],
  transition: ['transitionSafety', 'overallFallRisk'],
  walking:    ['gaitRegularity', 'lateralSway', 'overallFallRisk'],
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function ScoreDashboard({ scores, mode, initialized }: Props) {
  const activeKeys = ACTIVE_SCORES[mode];

  return (
    <View style={styles.container}>

      {/* ── OVERALL FALL RISK — spans full width, largest box ──────────────── */}
      <ScoreBox
        label="Overall Fall Risk"
        value={scores.overallFallRisk}
        active={activeKeys.includes('overallFallRisk')}
        initialized={initialized}
        large
      />

      {/* ── FOUR SECONDARY SCORES — two rows of two ────────────────────────── */}
      <View style={styles.row}>
        <ScoreBox
          label="Balance Stability"
          value={scores.balanceStability}
          active={activeKeys.includes('balanceStability')}
          initialized={initialized}
        />
        <ScoreBox
          label="Transition Safety"
          value={scores.transitionSafety}
          active={activeKeys.includes('transitionSafety')}
          initialized={initialized}
        />
      </View>

      <View style={styles.row}>
        <ScoreBox
          label="Gait Regularity"
          value={scores.gaitRegularity}
          active={activeKeys.includes('gaitRegularity')}
          initialized={initialized}
        />
        <ScoreBox
          label="Lateral Sway"
          value={scores.lateralSway}
          active={activeKeys.includes('lateralSway')}
          initialized={initialized}
        />
      </View>

    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORE BOX SUB-COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

interface BoxProps {
  label:       string;
  value:       number;
  active:      boolean;   // if false, box is dimmed (inactive mode)
  initialized: boolean;   // if false, show "—" (no data yet)
  large?:      boolean;   // true for the Overall score (takes full row width)
}

function ScoreBox({ label, value, active, initialized, large }: BoxProps) {
  const color   = scoreColor(value);
  const sublabel = initialized ? scoreLabel(value) : 'Waiting…';

  return (
    <View
      style={[
        styles.box,
        large && styles.boxLarge,
        // Dim inactive scores to 40% opacity instead of hiding them
        !active && styles.boxInactive,
        // Colour the left border to give a quick at-a-glance signal
        { borderLeftColor: color, borderLeftWidth: 4 },
      ]}
    >
      {/* Score label (e.g. "Gait Regularity") */}
      <Text style={[styles.boxLabel, !active && styles.textInactive]}>
        {label}
      </Text>

      {/* The score number — large and coloured when active */}
      <Text style={[
        styles.boxValue,
        { color: active ? color : '#4a7090' },
        large && styles.boxValueLarge,
      ]}>
        {initialized ? value : '—'}
      </Text>

      {/* Risk level text (Low risk / Moderate / High risk / Critical) */}
      <Text style={[styles.boxSublabel, { color: active ? color : '#4a7090' }]}>
        {initialized ? sublabel : ''}
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(13, 27, 42, 0.90)',
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8,
  },

  row: {
    flexDirection: 'row',
    gap: 8,
  },

  box: {
    flex: 1,
    backgroundColor: 'rgba(18, 32, 51, 0.95)',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#1e3a50',
  },

  boxLarge: {
    // Overall score gets a slightly taller box
    paddingVertical: 14,
  },

  boxInactive: {
    opacity: 0.45,
  },

  boxLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#4a7090',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },

  textInactive: {
    color: '#2a4a60',
  },

  boxValue: {
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 32,
  },

  boxValueLarge: {
    fontSize: 36,
    lineHeight: 40,
  },

  boxSublabel: {
    fontSize: 10,
    fontWeight: '500',
    marginTop: 2,
    opacity: 0.85,
  },
});
