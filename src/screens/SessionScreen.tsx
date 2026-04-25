/**
 * src/screens/SessionScreen.tsx — LIVE SESSION (TAB 1)
 *
 * DATA PIPELINE:
 *   MediaPipe WebView → postMessage → onMessage
 *     → PoseDetectors → aggregateScores → ScoreDashboard (live scores)
 *     → recordingBuffer (when recording) → analyzeRecording → Dashboard
 *
 * RECORDING FLOW:
 *   User taps "Record" → pose frames buffered for up to 60s
 *   → timer reaches 0 OR user taps "Stop"
 *   → analyzeRecording() processes full dataset
 *   → result saved to AsyncStorage
 *   → navigates to Results tab automatically
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, Platform, Alert,
} from 'react-native';
import WebView, { WebViewMessageEvent } from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { CompositeNavigationProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { MainTabParamList } from '../navigation/MainTabs';
import { SessionMode, PoseFrame, UserProfile, RiskScores } from '../types';
import { PoseDetectors } from '../engine/detectors';
import { aggregateScores } from '../engine/scoreAggregator';
import {
  analyzeRecording,
  saveAnalysis,
  RecordedFrame,
} from '../engine/analyzeRecording';
import { ExercisePipeline } from '../engine/exercise/pipeline';
import {
  buildExportPayload,
  buildSessionJson,
  postSessionToBackend,
  postSessionToLocalExports,
  shareSessionViaSheet,
} from '../engine/exercise/exporter';
import { buildLandmarkCsv } from '../engine/csvLogger';
import { BACKEND_URL, LOCAL_EXPORTS_URL } from '../constants';
import ScoreDashboard from '../components/ScoreDashboard';
import { POSE_HTML } from '../engine/poseHtml';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS + TYPES
// ─────────────────────────────────────────────────────────────────────────────
const MAX_RECORD_SEC = 60;

type NavProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Live'>,
  NativeStackNavigationProp<RootStackParamList>
>;

const DEFAULT_SCORES: RiskScores = {
  balanceStability: 50,
  transitionSafety: 50,
  gaitRegularity:   50,
  lateralSway:      50,
  overallFallRisk:  50,
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function SessionScreen() {
  const navigation = useNavigation<NavProp>();

  const [mode,        setMode]        = useState<SessionMode>('standing');
  const [scores,      setScores]      = useState<RiskScores>(DEFAULT_SCORES);
  const [initialized, setInitialized] = useState(false);
  const [webViewActive, setWebViewActive] = useState(false);

  // ── Recording state ───────────────────────────────────────────────────────
  const [recordState, setRecordState]   = useState<'idle' | 'recording' | 'analyzing'>('idle');
  const [timeLeft,    setTimeLeft]      = useState(MAX_RECORD_SEC);

  const recordingFrames = useRef<RecordedFrame[]>([]);
  const webViewRef      = useRef<WebView>(null);
  const profileRef      = useRef<UserProfile | null>(null);
  const detectorsRef    = useRef(new PoseDetectors());
  const recordStateRef  = useRef(recordState);
  // Exercise pipeline: instantiated fresh on each recording start so reps
  // detected in the previous run don't bleed into the next.
  const pipelineRef        = useRef<ExercisePipeline | null>(null);
  const recordStartedAtRef = useRef<number>(0);

  useEffect(() => { recordStateRef.current = recordState; }, [recordState]);

  // ── Load user profile once ────────────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem('sentinel_profile').then(raw => {
      if (raw) profileRef.current = JSON.parse(raw) as UserProfile;
    });
  }, []);

  // ── WebView on/off with screen focus ──────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      setWebViewActive(true);
      return () => setWebViewActive(false);
    }, [])
  );

  // ── Countdown timer while recording ──────────────────────────────────────
  useEffect(() => {
    if (recordState !== 'recording') return;

    setTimeLeft(MAX_RECORD_SEC);

    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          finishRecording();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordState]);

  // ── Mode change: reset detector buffers ──────────────────────────────────
  const handleModeChange = useCallback((newMode: SessionMode) => {
    detectorsRef.current.reset();
    setMode(newMode);
  }, []);

  // ── Receive landmarks from MediaPipe WebView ──────────────────────────────
  const onMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type !== 'pose' || !Array.isArray(msg.landmarks)) return;

      const pose = msg.landmarks as PoseFrame;

      if (recordStateRef.current === 'recording') {
        const t = Date.now();
        recordingFrames.current.push({ t, pose });
        // Rep detection is post-hoc — onFrame only collects frames.
        // Reps are detected in finalize() after the recording ends.
        pipelineRef.current?.onFrame(t, pose);
      }

      detectorsRef.current.update(pose, mode);
      const demographicRisk = profileRef.current?.demographicRiskScore ?? 0;
      setScores(aggregateScores(detectorsRef.current.measurements, demographicRisk));
      if (!initialized) setInitialized(true);

    } catch { /* ignore malformed messages */ }
  }, [mode, initialized]);

  // ── Start recording ───────────────────────────────────────────────────────
  const startRecording = useCallback(() => {
    recordingFrames.current = [];
    recordStartedAtRef.current = Date.now();
    pipelineRef.current = new ExercisePipeline('squat');
    setRecordState('recording');
  }, []);

  // ── Finish recording: analyze + save + export (backend POST + share) ──────
  const finishRecording = useCallback(async () => {
    setRecordState('analyzing');

    const frames = recordingFrames.current;
    const demographicRisk = profileRef.current?.demographicRiskScore ?? 0;

    const result = analyzeRecording(frames, demographicRisk);
    await saveAnalysis(result);

    // Finalize the exercise pipeline and export the full session schema.
    const pipe = pipelineRef.current;
    if (pipe) {
      try {
        const session   = pipe.finalize();
        const startedAt = recordStartedAtRef.current || (frames[0]?.t ?? Date.now());
        const endedAt   = frames[frames.length - 1]?.t ?? Date.now();
        const frameFeatures = pipe.getFrameBuffer();
        const payload = buildExportPayload(result.id, startedAt, endedAt, session, frameFeatures);

        console.log(`[export] ${session.reps.length} rep(s):`, JSON.stringify(session.summary));

        // ── 1. AsyncStorage backup — always succeeds, no network needed ──────
        // Guarantees the schema is never lost even if the Metro POST fails.
        const sessionJson = buildSessionJson(result.id, startedAt, endedAt, session);
        await AsyncStorage.setItem(`sentinel_schema_${result.id}`, sessionJson);

        // ── 2. Backend POST to Railway /sessions/exercise-result ────────────
        const framesCsv = buildLandmarkCsv(frames, mode);

        // 2a) MUST-HAVE local artifacts in root /exports via local backend.
        const localExportRes = await postSessionToLocalExports(LOCAL_EXPORTS_URL, payload, framesCsv);
        if (localExportRes.ok) {
          console.log('[export] local artifacts saved:', localExportRes.writtenTo, localExportRes.files);
        } else {
          console.warn('[export] local artifact write failed:', localExportRes.error);
        }

        // 2b) Railway/Postgres ingest (non-fatal if it fails).
        const backendRes = await postSessionToBackend(BACKEND_URL, payload);
        if (backendRes.ok) {
          console.log('[export] session stored:', backendRes.id, backendRes.linkedSessionId);
          if (localExportRes.ok && localExportRes.writtenTo) {
            Alert.alert(
              'Session exported',
              `Railway upload succeeded.\nLocal files saved at:\n${localExportRes.writtenTo}`,
            );
          } else {
            Alert.alert('Session exported', 'Uploaded successfully to backend.');
          }
        } else {
          const detail = backendRes.detail ?? backendRes.error ?? 'Unknown backend error';
          console.error('[export] backend POST failed:', detail);
          // Non-fatal: report error, continue session flow, and offer manual share.
          if (localExportRes.ok && localExportRes.writtenTo) {
            Alert.alert(
              'Railway upload failed (non-fatal)',
              `${detail}\n\nLocal export is saved at:\n${localExportRes.writtenTo}`,
            );
          } else {
            Alert.alert('Backend export failed', detail);
          }
          await shareSessionViaSheet(payload);
        }

      } catch (e) {
        console.error('[export] crash:', e);
        Alert.alert('Export error', String((e as Error).message));
      }
    }

    setRecordState('idle');
    recordingFrames.current = [];
    pipelineRef.current = null;
    navigation.navigate('Results');
  }, [navigation, mode]);

  // ── Reset profile ─────────────────────────────────────────────────────────
  const handleReset = () => {
    Alert.alert('Reset profile?', 'Returns you to the intake form.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset', style: 'destructive',
        onPress: async () => {
          await AsyncStorage.removeItem('sentinel_profile');
          navigation.navigate('Intake');
        },
      },
    ]);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>

      {/* ── FULL-SCREEN MEDIAPIPE WEBVIEW ─────────────────────────────── */}
      {webViewActive && (
        <WebView
          ref={webViewRef}
          style={StyleSheet.absoluteFill}
          source={{ html: POSE_HTML, baseUrl: 'https://localhost' }}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grant"
          originWhitelist={['*']}
          mixedContentMode="always"
          javaScriptEnabled
          onMessage={onMessage}
        />
      )}

      {/* ── RN OVERLAY ────────────────────────────────────────────────── */}
      <SafeAreaView style={styles.overlay} pointerEvents="box-none">

        {/* ── TOP BAR ──────────────────────────────────────────────────── */}
        <View style={styles.topBar}>
          <Text style={styles.title}>SENTINEL</Text>
          <StatusPill ready={initialized} />
          <TouchableOpacity style={styles.resetBtn} onPress={handleReset}>
            <Text style={styles.resetBtnText}>Reset</Text>
          </TouchableOpacity>
        </View>

        <View style={{ flex: 1 }} pointerEvents="none" />

        {/* ── BOTTOM PANEL ─────────────────────────────────────────────── */}
        <View pointerEvents="auto">
          <ScoreDashboard scores={scores} mode={mode} initialized={initialized} />
          <RecordButton
            state={recordState}
            timeLeft={timeLeft}
            onStart={startRecording}
            onStop={finishRecording}
          />
          <ModeSelector mode={mode} onChange={handleModeChange} />
        </View>

      </SafeAreaView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RECORD BUTTON
// ─────────────────────────────────────────────────────────────────────────────

function RecordButton({
  state, timeLeft, onStart, onStop,
}: {
  state:    'idle' | 'recording' | 'analyzing';
  timeLeft: number;
  onStart:  () => void;
  onStop:   () => void;
}) {
  if (state === 'analyzing') {
    return (
      <View style={styles.recordBar}>
        <Text style={styles.analyzingText}>Analyzing recording…</Text>
      </View>
    );
  }

  if (state === 'recording') {
    return (
      <View style={styles.recordBar}>
        <View style={styles.countdownBadge}>
          <Text style={styles.countdownText}>{timeLeft}s</Text>
        </View>
        <Text style={styles.recordingLabel}>Recording — stay in frame</Text>
        <TouchableOpacity style={styles.stopBtn} onPress={onStop}>
          <Text style={styles.stopBtnText}>■ Stop</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.recordBar}>
      <TouchableOpacity style={styles.recordBtn} onPress={onStart}>
        <Text style={styles.recordBtnText}>⬤  Record 60s Analysis</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS PILL + MODE SELECTOR
// ─────────────────────────────────────────────────────────────────────────────

function StatusPill({ ready }: { ready: boolean }) {
  const color = ready ? '#00c853' : '#f0a500';
  const label = ready ? 'LIVE' : 'LOADING';
  return (
    <View style={[styles.pill, { backgroundColor: color + '33' }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

function ModeSelector({
  mode, onChange,
}: { mode: SessionMode; onChange: (m: SessionMode) => void }) {
  const modes: { key: SessionMode; label: string; sub: string }[] = [
    { key: 'standing',   label: 'Standing',   sub: 'Balance' },
    { key: 'transition', label: 'Transition', sub: 'Sit ↔ Stand' },
    { key: 'walking',    label: 'Walking',    sub: 'Gait' },
  ];
  return (
    <View style={styles.modeBar}>
      {modes.map(({ key, label, sub }) => {
        const active = mode === key;
        return (
          <TouchableOpacity
            key={key}
            style={[styles.modeBtn, active && styles.modeBtnActive]}
            onPress={() => onChange(key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.modeBtnLabel, active && styles.activeTxt]}>{label}</Text>
            <Text style={[styles.modeBtnSub,   active && styles.activeTxt]}>{sub}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  bg:     '#0d1b2a',
  border: '#1e3a50',
  accent: '#00d4ff',
  muted:  '#4a7090',
};

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#000' },
  overlay: { flex: 1 },

  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: 'rgba(13,27,42,0.80)', gap: 10,
  },
  title:        { flex: 1, fontSize: 18, fontWeight: '800', color: C.accent, letterSpacing: 4 },
  pill:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, gap: 5 },
  dot:          { width: 6, height: 6, borderRadius: 3 },
  pillText:     { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  resetBtn:     { paddingHorizontal: 10, paddingVertical: 4 },
  resetBtnText: { fontSize: 12, color: C.muted, fontWeight: '500' },

  recordBar: {
    backgroundColor: 'rgba(13,27,42,0.92)',
    paddingHorizontal: 12, paddingVertical: 10,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderTopWidth: 1, borderTopColor: C.border,
  },
  recordBtn: {
    flex: 1, backgroundColor: 'rgba(0,212,255,0.08)',
    borderWidth: 1, borderColor: C.accent,
    borderRadius: 10, paddingVertical: 10, alignItems: 'center',
  },
  recordBtnText:  { color: C.accent, fontSize: 14, fontWeight: '700' },
  countdownBadge: { backgroundColor: '#f44336', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minWidth: 48, alignItems: 'center' },
  countdownText:  { color: '#fff', fontSize: 16, fontWeight: '800' },
  recordingLabel: { flex: 1, color: '#f44336', fontSize: 12, fontWeight: '600' },
  stopBtn:        { backgroundColor: 'rgba(244,67,54,0.15)', borderWidth: 1, borderColor: '#f44336', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  stopBtnText:    { color: '#f44336', fontSize: 13, fontWeight: '700' },
  analyzingText:  { flex: 1, color: C.accent, fontSize: 13, fontWeight: '600', textAlign: 'center' },

  modeBar: {
    flexDirection: 'row', backgroundColor: 'rgba(13,27,42,0.95)',
    paddingHorizontal: 12, paddingVertical: 10, gap: 10,
    paddingBottom: Platform.OS === 'ios' ? 4 : 10,
  },
  modeBtn:       { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: 'rgba(18,32,51,0.6)', gap: 3 },
  modeBtnActive: { borderColor: C.accent, backgroundColor: 'rgba(0,212,255,0.12)' },
  modeBtnLabel:  { fontSize: 13, fontWeight: '600', color: C.muted },
  modeBtnSub:    { fontSize: 10, color: C.muted, opacity: 0.6 },
  activeTxt:     { color: C.accent, opacity: 1 },
});
