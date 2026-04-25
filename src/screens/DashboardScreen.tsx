/**
 * src/screens/DashboardScreen.tsx — ANALYSIS HISTORY + FALL RISK REPORT
 *
 * This screen shows the results of recorded sessions.
 * Each time the user records and analyzes a session, a result is saved to
 * AsyncStorage and shown here as a card.
 *
 * LAYOUT:
 *   ┌─────────────────────────────────────────┐
 *   │  DASHBOARD            (header)          │
 *   │                                         │
 *   │  ┌─────────────────────────────────┐    │
 *   │  │  LATEST ANALYSIS                │    │  ← most recent, expanded
 *   │  │  Overall Score  82  ●  Low risk  │    │
 *   │  │                                 │    │
 *   │  │  Balance  76  Gait  88           │    │
 *   │  │  Sway     71  Transition  91     │    │
 *   │  │                                 │    │
 *   │  │  KEY FINDINGS:                  │    │
 *   │  │  • Step timing consistent…      │    │
 *   │  │  • Side-to-side hip movement…   │    │
 *   │  └─────────────────────────────────┘    │
 *   │                                         │
 *   │  HISTORY (past analyses, compact)       │
 *   │  ─────────────────────────────────      │
 *   │  Apr 22 at 2:30 PM       82 ●  Low      │
 *   │  Apr 22 at 10:15 AM      61 ●  Moderate │
 *   └─────────────────────────────────────────┘
 *
 * Empty state: shown when no analyses have been recorded yet.
 * It guides the user back to the Live tab to record their first session.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { AnalysisResult, loadAnalyses } from '../engine/analyzeRecording';
import { scoreColor, scoreLabel } from '../engine/scoreAggregator';
import { RiskScores } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const [analyses, setAnalyses] = useState<AnalysisResult[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  /** Load analyses from AsyncStorage every time this tab becomes active. */
  const loadData = useCallback(async () => {
    const data = await loadAnalyses();
    setAnalyses(data);
  }, []);

  // useFocusEffect runs loadData whenever the user navigates to this tab,
  // so if they record a new session on the Live tab, it shows up immediately.
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  // ─────────────────────────────────────────────────────────────────────────
  // EMPTY STATE
  // ─────────────────────────────────────────────────────────────────────────

  if (analyses.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>📊</Text>
        <Text style={styles.emptyTitle}>No analyses yet</Text>
        <Text style={styles.emptyBody}>
          Go to the Live tab, tap the Record button, move around for up to 60 seconds,
          then stop — SENTINEL will analyze your gait and balance and show the results here.
        </Text>
      </View>
    );
  }

  const latest  = analyses[0];
  const history = analyses.slice(1);

  // ─────────────────────────────────────────────────────────────────────────
  // MAIN RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00d4ff" />
      }
    >
      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <Text style={styles.header}>Dashboard</Text>
      <Text style={styles.subheader}>Fall risk analysis history</Text>

      {/* ── LATEST ANALYSIS (full card) ────────────────────────────────── */}
      <Text style={styles.sectionLabel}>LATEST ANALYSIS</Text>
      <FullResultCard result={latest} />

      {/* ── HISTORY (compact rows) ─────────────────────────────────────── */}
      {history.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>HISTORY</Text>
          {history.map(r => (
            <CompactResultRow key={r.id} result={r} />
          ))}
        </>
      )}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FULL RESULT CARD — shown for the most recent analysis
// ─────────────────────────────────────────────────────────────────────────────

function FullResultCard({ result }: { result: AnalysisResult }) {
  const overallColor = scoreColor(result.scores.overallFallRisk);

  return (
    <View style={styles.card}>

      {/* ── Overall score ──────────────────────────────────────────────── */}
      <View style={styles.overallRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardDate}>{result.date}</Text>
          <Text style={styles.cardDuration}>{result.durationSec}s recorded</Text>
        </View>
        <View style={[styles.overallBadge, { borderColor: overallColor }]}>
          <Text style={[styles.overallScore, { color: overallColor }]}>
            {result.scores.overallFallRisk}
          </Text>
          <Text style={[styles.overallLabel, { color: overallColor }]}>
            {scoreLabel(result.scores.overallFallRisk).toUpperCase()}
          </Text>
        </View>
      </View>

      {/* ── Four sub-scores ────────────────────────────────────────────── */}
      <View style={styles.scoresGrid}>
        <MiniScore label="Balance"    value={result.scores.balanceStability} />
        <MiniScore label="Gait"       value={result.scores.gaitRegularity}   />
        <MiniScore label="Sway"       value={result.scores.lateralSway}       />
        <MiniScore label="Transition" value={result.scores.transitionSafety} />
      </View>

      {/* ── Metrics row ────────────────────────────────────────────────── */}
      <View style={styles.metricsRow}>
        <MetricChip label="Steps"   value={String(result.metrics.totalSteps)} />
        <MetricChip label="Rhythm CV" value={result.metrics.stepRhythmCV.toFixed(2)} />
        <MetricChip label="Max Sway"  value={(result.metrics.maxLateralSway * 100).toFixed(1) + '%'} />
      </View>

      {/* ── Key findings ───────────────────────────────────────────────── */}
      <View style={styles.findingsBox}>
        <Text style={styles.findingsTitle}>KEY FINDINGS</Text>
        {result.findings.map((f, i) => (
          <View key={i} style={styles.findingRow}>
            <Text style={styles.findingBullet}>•</Text>
            <Text style={styles.findingText}>{f}</Text>
          </View>
        ))}
      </View>

    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPACT HISTORY ROW — shown for older analyses
// ─────────────────────────────────────────────────────────────────────────────

function CompactResultRow({ result }: { result: AnalysisResult }) {
  const color = scoreColor(result.scores.overallFallRisk);
  return (
    <View style={styles.historyRow}>
      <Text style={styles.historyDate}>{result.date}</Text>
      <View style={styles.historyScoreRow}>
        <View style={[styles.historyDot, { backgroundColor: color }]} />
        <Text style={[styles.historyScore, { color }]}>
          {result.scores.overallFallRisk}
        </Text>
        <Text style={styles.historyLabel}>{scoreLabel(result.scores.overallFallRisk)}</Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SMALL SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function MiniScore({ label, value }: { label: string; value: number }) {
  const color = scoreColor(value);
  return (
    <View style={styles.miniScore}>
      <Text style={[styles.miniScoreValue, { color }]}>{value}</Text>
      <Text style={styles.miniScoreLabel}>{label}</Text>
    </View>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipValue}>{value}</Text>
      <Text style={styles.chipLabel}>{label}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  bg:     '#0d1b2a',
  card:   '#0f2235',
  border: '#1e3a50',
  accent: '#00d4ff',
  text:   '#e8f4f8',
  muted:  '#4a7090',
  dim:    '#1a3045',
};

const styles = StyleSheet.create({
  scroll:  { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 16, paddingTop: 60, paddingBottom: 32 },

  header:    { fontSize: 28, fontWeight: '800', color: C.accent, letterSpacing: 2 },
  subheader: { fontSize: 13, color: C.muted, marginTop: 4, marginBottom: 24 },

  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: C.muted,
    letterSpacing: 1.5, marginBottom: 10, marginTop: 8,
  },

  // ── Full result card ──────────────────────────────────────────────────────
  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    marginBottom: 16,
    gap: 14,
  },

  overallRow: { flexDirection: 'row', alignItems: 'center' },
  cardDate:   { fontSize: 14, fontWeight: '600', color: C.text },
  cardDuration: { fontSize: 12, color: C.muted, marginTop: 2 },

  overallBadge: {
    alignItems: 'center',
    borderWidth: 2,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 80,
  },
  overallScore: { fontSize: 32, fontWeight: '800', lineHeight: 36 },
  overallLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, marginTop: 2 },

  scoresGrid: { flexDirection: 'row', justifyContent: 'space-between' },
  miniScore:  { alignItems: 'center', flex: 1 },
  miniScoreValue: { fontSize: 22, fontWeight: '700' },
  miniScoreLabel: { fontSize: 10, color: C.muted, marginTop: 2 },

  metricsRow: { flexDirection: 'row', gap: 8 },
  chip: {
    flex: 1, alignItems: 'center',
    backgroundColor: C.dim,
    borderRadius: 8, paddingVertical: 8,
  },
  chipValue: { fontSize: 14, fontWeight: '700', color: C.text },
  chipLabel: { fontSize: 10, color: C.muted, marginTop: 2 },

  findingsBox: {
    backgroundColor: 'rgba(0,212,255,0.04)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,212,255,0.12)',
    padding: 12,
    gap: 8,
  },
  findingsTitle: { fontSize: 10, fontWeight: '700', color: C.accent, letterSpacing: 1.5 },
  findingRow: { flexDirection: 'row', gap: 8 },
  findingBullet: { color: C.accent, fontSize: 12, lineHeight: 18 },
  findingText: { flex: 1, fontSize: 12, color: C.text, lineHeight: 18, opacity: 0.85 },

  // ── History rows ──────────────────────────────────────────────────────────
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  historyDate:     { flex: 1, fontSize: 13, color: C.muted },
  historyScoreRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  historyDot:      { width: 8, height: 8, borderRadius: 4 },
  historyScore:    { fontSize: 18, fontWeight: '700' },
  historyLabel:    { fontSize: 12, color: C.muted, marginLeft: 4 },

  // ── Empty state ───────────────────────────────────────────────────────────
  emptyContainer: {
    flex: 1,
    backgroundColor: C.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyIcon:  { fontSize: 56, marginBottom: 20 },
  emptyTitle: { fontSize: 22, fontWeight: '700', color: C.text, marginBottom: 12 },
  emptyBody:  { fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 22 },
});
