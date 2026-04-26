import React, { useCallback, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { AnalysisResult, loadAnalyses } from '../engine/analyzeRecording';
import {
  fetchLatestReport,
  fetchPatientOverview,
  fetchProgressReport,
  PatientOverview,
} from '../engine/backendClient';
import { loadStoredProfile } from '../engine/profileStorage';
import { scoreColor, scoreLabel } from '../engine/scoreAggregator';
import { UserProfile } from '../types';

type LatestReport = {
  summary: string;
  session_highlights: string[];
  recommendations: string[];
} | null;

type ProgressReport = {
  longitudinal_report: string;
  overall_trend: string;
  milestones_reached: string[];
  next_goals: string[];
} | null;

const C = {
  bg: '#0d1b2a',
  card: '#0f2235',
  border: '#1e3a50',
  accent: '#00d4ff',
  text: '#e8f4f8',
  muted: '#4a7090',
  dim: '#1a3045',
  good: '#00c853',
  warn: '#f0a500',
};

export default function DashboardScreen() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [overview, setOverview] = useState<PatientOverview | null>(null);
  const [latestReport, setLatestReport] = useState<LatestReport>(null);
  const [progressReport, setProgressReport] = useState<ProgressReport>(null);
  const [analyses, setAnalyses] = useState<AnalysisResult[]>([]);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    const [storedProfile, localAnalyses] = await Promise.all([
      loadStoredProfile(),
      loadAnalyses(),
    ]);

    setProfile(storedProfile);
    setAnalyses(localAnalyses);
    setOverview(null);
    setLatestReport(null);
    setProgressReport(null);
    setBackendError(null);

    if (!storedProfile?.patientId) return;

    try {
      const patientOverview = await fetchPatientOverview(storedProfile.patientId);
      setOverview(patientOverview);

      if (patientOverview.session_count > 0) {
        try {
          setLatestReport(await fetchLatestReport(storedProfile.patientId));
        } catch {
          setLatestReport(null);
        }
      }

      if (patientOverview.session_count >= 3) {
        try {
          setProgressReport(await fetchProgressReport(storedProfile.patientId));
        } catch {
          setProgressReport(null);
        }
      }
    } catch (e) {
      setBackendError((e as Error).message);
    }
  }, []);

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

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />
      }
    >
      <Text style={styles.header}>Patient Record</Text>
      <Text style={styles.subheader}>
        Metadata, sessions, latest summary, and progress over time
      </Text>

      <PatientCard profile={profile} overview={overview} backendError={backendError} />

      {latestReport && (
        <>
          <Text style={styles.sectionLabel}>LATEST CLINICAL SUMMARY</Text>
          <NarrativeCard title="Latest report" body={latestReport.summary} />
        </>
      )}

      {progressReport && (
        <>
          <Text style={styles.sectionLabel}>PROGRESS OVER TIME</Text>
          <NarrativeCard
            title={`Trend: ${progressReport.overall_trend}`}
            body={progressReport.longitudinal_report}
            chips={[
              ...progressReport.milestones_reached.map(item => `Milestone: ${item}`),
              ...progressReport.next_goals.map(item => `Next: ${item}`),
            ]}
          />
        </>
      )}

      {overview?.recent_sessions?.length ? (
        <>
          <Text style={styles.sectionLabel}>BACKEND SESSION TIMELINE</Text>
          {overview.recent_sessions.map(session => (
            <BackendSessionCard key={session.session_id} session={session} />
          ))}
        </>
      ) : null}

      {analyses.length ? (
        <>
          <Text style={styles.sectionLabel}>ON-DEVICE HISTORY</Text>
          <FullResultCard result={analyses[0]} />
          {analyses.slice(1).map(result => (
            <CompactResultRow key={result.id} result={result} />
          ))}
        </>
      ) : !overview?.recent_sessions?.length ? (
        <EmptyState />
      ) : null}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

function PatientCard({
  profile,
  overview,
  backendError,
}: {
  profile: UserProfile | null;
  overview: PatientOverview | null;
  backendError: string | null;
}) {
  const metadata = overview?.metadata ?? profile ?? null;
  const synced = Boolean(profile?.backendProfileSyncedAt);

  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Patient ID</Text>
          <Text style={styles.primaryValue}>{profile?.patientId ?? 'Not assigned'}</Text>
        </View>
        <View style={[styles.statusPill, { borderColor: synced ? C.good : C.warn }]}>
          <Text style={[styles.statusText, { color: synced ? C.good : C.warn }]}>
            {synced ? 'Synced' : 'Pending sync'}
          </Text>
        </View>
      </View>

      <View style={styles.metricsRow}>
        <MetricChip label="Age" value={metadata ? String(metadata.age) : '--'} />
        <MetricChip label="BMI" value={metadata ? metadata.bmi.toFixed(1) : '--'} />
        <MetricChip label="Sessions" value={overview ? String(overview.session_count) : '--'} />
      </View>

      <View style={styles.metricsRow}>
        <MetricChip
          label="Fall avg"
          value={formatScore(overview?.accumulated_scores?.fall_risk_avg)}
        />
        <MetricChip
          label="Reinjury avg"
          value={formatScore(overview?.accumulated_scores?.reinjury_risk_avg)}
        />
      </View>

      <Text style={styles.helperText}>
        {metadata
          ? `${metadata.gender}, ${metadata.heightCm} cm, ${metadata.weightKg} kg`
          : 'Complete intake to populate patient metadata.'}
      </Text>

      {backendError ? (
        <Text style={styles.warningText}>
          Backend record unavailable: {backendError}. Local history is still shown below.
        </Text>
      ) : null}
    </View>
  );
}

function NarrativeCard({
  title,
  body,
  chips = [],
}: {
  title: string;
  body: string;
  chips?: string[];
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.bodyText}>{body}</Text>
      {chips.length ? (
        <View style={styles.chipsWrap}>
          {chips.map(chip => (
            <View key={chip} style={styles.tag}>
              <Text style={styles.tagText}>{chip}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function BackendSessionCard({
  session,
}: {
  session: PatientOverview['recent_sessions'][number];
}) {
  const isExerciseVisit = session.kind === 'exercise';
  const titleText = isExerciseVisit
    ? (session.exercises.length > 0 ? session.exercises.join(' · ') : 'Exercise visit')
    : 'PT session';
  const exerciseCountChip = isExerciseVisit && session.num_exercises > 0
    ? `${session.num_exercises} exercise${session.num_exercises === 1 ? '' : 's'}`
    : null;
  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{titleText}</Text>
          <Text style={styles.helperText}>
            {formatBackendDate(session.started_at)}
            {exerciseCountChip ? ` • ${exerciseCountChip}` : ''}
          </Text>
        </View>
        <View style={styles.kindBadge}>
          <Text style={styles.kindBadgeText}>{session.kind.toUpperCase()}</Text>
        </View>
      </View>

      <View style={styles.metricsRow}>
        <MetricChip label="Fall risk" value={formatScore(session.fall_risk_score)} />
        <MetricChip label="Reinjury" value={formatScore(session.reinjury_risk_score)} />
        <MetricChip label="ROM" value={formatScore(session.rom_score)} />
      </View>

      {session.summary ? <Text style={styles.bodyText}>{session.summary}</Text> : null}
    </View>
  );
}

function FullResultCard({ result }: { result: AnalysisResult }) {
  const overallColor = scoreColor(result.scores.overallFallRisk);

  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{result.date}</Text>
          <Text style={styles.helperText}>{result.durationSec}s recorded on device</Text>
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

      <View style={styles.metricsRow}>
        <MetricChip label="Balance" value={String(result.scores.balanceStability)} />
        <MetricChip label="Gait" value={String(result.scores.gaitRegularity)} />
        <MetricChip label="Sway" value={String(result.scores.lateralSway)} />
      </View>

      <View style={styles.metricsRow}>
        <MetricChip label="Steps" value={String(result.metrics.totalSteps)} />
        <MetricChip label="Rhythm CV" value={result.metrics.stepRhythmCV.toFixed(2)} />
        <MetricChip
          label="Max sway"
          value={`${(result.metrics.maxLateralSway * 100).toFixed(1)}%`}
        />
      </View>

      <View style={styles.findingsBox}>
        <Text style={styles.findingsTitle}>KEY FINDINGS</Text>
        {result.findings.map((finding, index) => (
          <Text key={`${result.id}-${index}`} style={styles.findingText}>
            - {finding}
          </Text>
        ))}
      </View>
    </View>
  );
}

function CompactResultRow({ result }: { result: AnalysisResult }) {
  const color = scoreColor(result.scores.overallFallRisk);
  return (
    <View style={styles.historyRow}>
      <Text style={styles.historyDate}>{result.date}</Text>
      <View style={styles.historyScoreRow}>
        <View style={[styles.historyDot, { backgroundColor: color }]} />
        <Text style={[styles.historyScore, { color }]}>{result.scores.overallFallRisk}</Text>
        <Text style={styles.historyLabel}>{scoreLabel(result.scores.overallFallRisk)}</Text>
      </View>
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

function EmptyState() {
  return (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyTitle}>No sessions yet</Text>
      <Text style={styles.emptyBody}>
        Record a session on the Live tab to create the patient timeline and progress history.
      </Text>
    </View>
  );
}

function formatScore(value: number | null | undefined): string {
  return typeof value === 'number' ? value.toFixed(0) : '--';
}

function formatBackendDate(value: string): string {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 16, paddingTop: 60, paddingBottom: 32 },

  header: { fontSize: 28, fontWeight: '800', color: C.accent, letterSpacing: 1.5 },
  subheader: { fontSize: 13, color: C.muted, marginTop: 4, marginBottom: 24 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: C.muted,
    letterSpacing: 1.5,
    marginBottom: 10,
    marginTop: 8,
  },

  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    marginBottom: 16,
    gap: 12,
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: C.text },
  primaryValue: { fontSize: 16, fontWeight: '600', color: C.accent, marginTop: 4 },
  bodyText: { fontSize: 13, lineHeight: 20, color: C.text, opacity: 0.9 },
  helperText: { fontSize: 12, color: C.muted, lineHeight: 18 },
  warningText: { fontSize: 12, color: C.warn, lineHeight: 18 },

  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  metricsRow: { flexDirection: 'row', gap: 8 },

  chip: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: C.dim,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  chipValue: { fontSize: 14, fontWeight: '700', color: C.text },
  chipLabel: { fontSize: 10, color: C.muted, marginTop: 2 },

  statusPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusText: { fontSize: 11, fontWeight: '700' },

  kindBadge: {
    backgroundColor: 'rgba(0,212,255,0.1)',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(0,212,255,0.35)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  kindBadgeText: { fontSize: 10, fontWeight: '700', color: C.accent, letterSpacing: 1 },

  tag: {
    backgroundColor: 'rgba(0,212,255,0.08)',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(0,212,255,0.18)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  tagText: { fontSize: 11, color: C.accent },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

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

  findingsBox: {
    backgroundColor: 'rgba(0,212,255,0.04)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,212,255,0.12)',
    padding: 12,
    gap: 6,
  },
  findingsTitle: { fontSize: 10, fontWeight: '700', color: C.accent, letterSpacing: 1.5 },
  findingText: { fontSize: 12, color: C.text, lineHeight: 18, opacity: 0.9 },

  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  historyDate: { flex: 1, fontSize: 13, color: C.muted },
  historyScoreRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  historyDot: { width: 8, height: 8, borderRadius: 4 },
  historyScore: { fontSize: 18, fontWeight: '700' },
  historyLabel: { fontSize: 12, color: C.muted, marginLeft: 4 },

  emptyContainer: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 24,
    alignItems: 'center',
  },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: C.text, marginBottom: 10 },
  emptyBody: { fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 22 },
});
