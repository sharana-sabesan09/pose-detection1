/**
 * src/screens/SessionScreen.tsx — LIVE SESSION (TAB 1)
 *
 * NEW MULTI-EXERCISE FLOW (replaces single 60s recording):
 *
 *   On mount → load patient.curr_program (list of prescribed exercises).
 *   User taps "Start Session" → run each exercise back-to-back:
 *
 *     For each exercise in curr_program:
 *       1. AWAITING — show "Next: <label>. Start when ready" + Start button
 *       2. RECORDING — fixed 30s, fresh ExercisePipeline per exercise
 *       3. On timer end (or stop) → finalize, buffer the entry, advance
 *
 *     After last exercise:
 *       4. ANALYZING — build MultiExerciseSession, POST to backend, share
 *       5. Navigate to Results
 *
 *   Live ScoreDashboard updates throughout from PoseDetectors. Mode is mapped
 *   from the current exercise (walking → 'walking', else → 'standing') so the
 *   dimming logic in ScoreDashboard still works.
 *
 * PATIENT DATA SOURCE: dummy JSON via loadPatientInfo() — see
 * src/engine/patientInfo.ts (TODO marker there for the SQL swap).
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, Platform, Alert, ScrollView,
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
  ExerciseType,
  SessionExerciseEntry,
} from '../engine/exercise/types';
import {
  buildExportPayload,
  buildSessionExerciseEntry,
  buildMultiExerciseSession,
  buildMultiSessionExportPayload,
  postSessionToBackend,
  postMultiSessionToLocalExports,
  shareMultiSessionViaSheet,
} from '../engine/exercise/exporter';
import { buildLandmarkCsv } from '../engine/csvLogger';
import { BACKEND_URL, LOCAL_EXPORTS_URL } from '../constants';
import ScoreDashboard from '../components/ScoreDashboard';
import { POSE_HTML } from '../engine/poseHtml';
import { loadStoredProfile, saveStoredProfile } from '../engine/profileStorage';
import { upsertPatientProfile } from '../engine/backendClient';
import { loadPatientInfo, PatientInfo } from '../engine/patientInfo';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS + TYPES
// ─────────────────────────────────────────────────────────────────────────────
const EXERCISE_DURATION_SEC = 30;

type SessionState = 'idle' | 'awaiting' | 'recording' | 'analyzing' | 'done';

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

function displayErrorDetail(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return 'Unknown backend error';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const EXERCISE_LABELS: Record<ExerciseType, string> = {
  leftSls:  'Left Single-Leg Squat',
  rightSls: 'Right Single-Leg Squat',
  leftLsd:  'Left Lateral Step-Down',
  rightLsd: 'Right Lateral Step-Down',
  walking:  'Walking',
};

function modeForExercise(e: ExerciseType): SessionMode {
  return e === 'walking' ? 'walking' : 'standing';
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function SessionScreen() {
  const navigation = useNavigation<NavProp>();

  const [scores,      setScores]      = useState<RiskScores>(DEFAULT_SCORES);
  const [initialized, setInitialized] = useState(false);
  const [webViewActive, setWebViewActive] = useState(false);

  // ── Session state ─────────────────────────────────────────────────────────
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [patient,      setPatient]      = useState<PatientInfo | null>(null);
  const [exerciseIdx,  setExerciseIdx]  = useState(0);
  const [timeLeft,     setTimeLeft]     = useState(EXERCISE_DURATION_SEC);

  // Mutable per-recording state lives in refs to avoid the message handler
  // re-binding on every render.
  const sessionStartedAtRef  = useRef<number>(0);
  const sessionIdRef         = useRef<string>('');
  const exerciseStartedAtRef = useRef<number>(0);
  const completedEntriesRef  = useRef<SessionExerciseEntry[]>([]);
  const framesByExerciseRef  = useRef<{ exercise: string; frames: ReturnType<ExercisePipeline['getFrameBuffer']> }[]>([]);
  const walkingRecordedFramesRef = useRef<RecordedFrame[]>([]);  // for analyzeRecording dashboard data

  const pipelineRef     = useRef<ExercisePipeline | null>(null);
  const profileRef      = useRef<UserProfile | null>(null);
  const detectorsRef    = useRef(new PoseDetectors());
  const sessionStateRef = useRef(sessionState);
  const webViewRef      = useRef<WebView>(null);

  useEffect(() => { sessionStateRef.current = sessionState; }, [sessionState]);

  const currentExercise: ExerciseType | null =
    patient && exerciseIdx < patient.curr_program.length
      ? patient.curr_program[exerciseIdx]
      : null;

  // ── Load profile + patient info on mount ─────────────────────────────────
  useEffect(() => {
    loadStoredProfile().then(async profile => {
      if (profile) {
        profileRef.current = profile;
        if (!profile.backendProfileSyncedAt) {
          try {
            await upsertPatientProfile(profile);
            const synced: UserProfile = { ...profile, backendProfileSyncedAt: new Date().toISOString() };
            profileRef.current = synced;
            await saveStoredProfile(synced);
          } catch (e) {
            console.warn('[SessionScreen] patient sync failed:', (e as Error).message);
          }
        }
      }
    });

    loadPatientInfo()
      .then(setPatient)
      .catch(e => console.warn('[SessionScreen] patient info load failed:', e));
  }, []);

  // ── WebView on/off with screen focus ──────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      setWebViewActive(true);
      return () => setWebViewActive(false);
    }, []),
  );

  // ── Countdown timer while recording ───────────────────────────────────────
  useEffect(() => {
    if (sessionState !== 'recording') return;
    setTimeLeft(EXERCISE_DURATION_SEC);

    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          finishCurrentExercise();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionState, exerciseIdx]);

  // ── Receive landmarks from MediaPipe WebView ──────────────────────────────
  const onMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type !== 'pose' || !Array.isArray(msg.landmarks)) return;

      const pose = msg.landmarks as PoseFrame;
      const ex   = currentExercise;

      if (sessionStateRef.current === 'recording' && pipelineRef.current) {
        const t = Date.now();
        pipelineRef.current.onFrame(t, pose);
        if (ex === 'walking') walkingRecordedFramesRef.current.push({ t, pose });
      }

      const liveMode: SessionMode = ex ? modeForExercise(ex) : 'standing';
      detectorsRef.current.update(pose, liveMode);
      const demographicRisk = profileRef.current?.demographicRiskScore ?? 0;
      setScores(aggregateScores(detectorsRef.current.measurements, demographicRisk));
      if (!initialized) setInitialized(true);

    } catch { /* ignore malformed messages */ }
  }, [currentExercise, initialized]);

  // ── Session lifecycle ─────────────────────────────────────────────────────
  const startSession = useCallback(() => {
    if (!patient || patient.curr_program.length === 0) {
      Alert.alert('No exercises prescribed', 'This patient has no curr_program entries.');
      return;
    }
    sessionIdRef.current = new Date().toISOString();
    sessionStartedAtRef.current = Date.now();
    completedEntriesRef.current = [];
    framesByExerciseRef.current = [];
    walkingRecordedFramesRef.current = [];
    setExerciseIdx(0);
    setSessionState('awaiting');
  }, [patient]);

  const startCurrentExercise = useCallback(() => {
    if (!currentExercise) return;
    exerciseStartedAtRef.current = Date.now();
    pipelineRef.current = new ExercisePipeline(currentExercise);
    detectorsRef.current.reset(); // fresh per-exercise live windows
    setSessionState('recording');
  }, [currentExercise]);

  const finishCurrentExercise = useCallback(() => {
    const ex = currentExercise;
    const pipe = pipelineRef.current;
    if (!ex || !pipe) return;

    const startedAt = exerciseStartedAtRef.current;
    const endedAt   = Date.now();
    try {
      const summary = pipe.finalize();
      completedEntriesRef.current.push(buildSessionExerciseEntry(summary, startedAt, endedAt));
      framesByExerciseRef.current.push({ exercise: ex, frames: pipe.getFrameBuffer() });
      console.log(`[session] ${ex}: ${summary.reps.length} reps,`, JSON.stringify(summary.summary));
    } catch (e) {
      console.error('[session] finalize crash:', e);
    }
    pipelineRef.current = null;

    const nextIdx = exerciseIdx + 1;
    if (patient && nextIdx < patient.curr_program.length) {
      setExerciseIdx(nextIdx);
      setSessionState('awaiting');
    } else {
      finalizeSession();
    }
  }, [currentExercise, exerciseIdx, patient]);

  const finalizeSession = useCallback(async () => {
    setSessionState('analyzing');

    const sessionId   = sessionIdRef.current;
    const startedAtMs = sessionStartedAtRef.current;
    const endedAtMs   = Date.now();
    const entries     = completedEntriesRef.current;
    const patientId   = profileRef.current?.patientId ?? patient?.patientId ?? 'unknown';
    const injuredJointName = patient?.injuredjoint ?? 'unknown';

    const multiSession = buildMultiExerciseSession(
      sessionId, startedAtMs, endedAtMs,
      patientId, injuredJointName,
      entries,
    );

    const payload = buildMultiSessionExportPayload(multiSession, framesByExerciseRef.current);

    // Live dashboard (Results tab) — only meaningful for walking. Skip if absent.
    if (walkingRecordedFramesRef.current.length > 0) {
      const demographicRisk = profileRef.current?.demographicRiskScore ?? 0;
      const result = analyzeRecording(walkingRecordedFramesRef.current, demographicRisk);
      await saveAnalysis({ ...result, id: sessionId });
    }

    try {
      // 1. AsyncStorage backup — never lose the schema
      await AsyncStorage.setItem(`sentinel_schema_${sessionId}`, JSON.stringify(multiSession));

      // 2. Local /exports dev artifact
      const framesCsv = buildLandmarkCsv(
        // analyzeRecording-style flat frames CSV across the whole session
        // (best-effort: union of every recorded walking frame; non-walking uses
        // pipeline frame features CSV that's already in the payload).
        walkingRecordedFramesRef.current,
        'walking',
      );
      const localRes = await postMultiSessionToLocalExports(LOCAL_EXPORTS_URL, payload, framesCsv);
      if (localRes.ok) {
        console.log('[export] local artifacts saved:', localRes.writtenTo, localRes.files);
      } else {
        console.warn('[export] local artifact write failed:', localRes.error);
      }

      // 3. Backend POST (current backend expects single-exercise payloads).
      // Fan out one request per exercise entry in this session.
      let uploadedCount = 0;
      const backendErrors: string[] = [];
      for (const [i, entry] of entries.entries()) {
        const exercisePayload = buildExportPayload(
          `${sessionId}-${entry.exercise}-${i + 1}`,
          entry.startedAtMs,
          entry.endedAtMs,
          entry.summary,
          framesByExerciseRef.current[i]?.frames ?? [],
          patientId,
        );
        const backendRes = await postSessionToBackend(BACKEND_URL, exercisePayload);
        if (backendRes.ok) uploadedCount += 1;
        else {
          backendErrors.push(displayErrorDetail(backendRes.detail ?? backendRes.error));
        }
      }

      if (backendErrors.length === 0) {
        Alert.alert(
          'Session exported',
          localRes.ok && localRes.writtenTo
            ? `Backend upload succeeded.\nLocal files saved at:\n${localRes.writtenTo}`
            : 'Uploaded successfully to backend.',
        );
      } else {
        const detail = backendErrors.join('\n');
        console.error('[export] backend POST failed:', detail);
        if (localRes.ok && localRes.writtenTo) {
          Alert.alert(
            'Backend upload partially failed (non-fatal)',
            `${uploadedCount}/${entries.length} exercise uploads succeeded.\n\n${detail}\n\nLocal: ${localRes.writtenTo}`,
          );
        } else {
          Alert.alert(
            'Backend upload partially failed',
            `${uploadedCount}/${entries.length} exercise uploads succeeded.\n\n${detail}`,
          );
        }
        await shareMultiSessionViaSheet(payload);
      }
    } catch (e) {
      console.error('[export] crash:', e);
      Alert.alert('Export error', String((e as Error).message));
    }

    setSessionState('done');
    navigation.navigate('Results');
  }, [navigation, patient]);

  const stopSessionEarly = useCallback(() => {
    Alert.alert('Stop session?', 'Discards remaining exercises and exports what you have.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Stop', style: 'destructive',
        onPress: () => {
          if (pipelineRef.current) finishCurrentExercise();
          else finalizeSession();
        },
      },
    ]);
  }, [finishCurrentExercise, finalizeSession]);

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

  const liveMode: SessionMode = currentExercise ? modeForExercise(currentExercise) : 'standing';

  return (
    <View style={styles.root}>
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

      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <ScrollView
          style={styles.overlayScroll}
          contentContainerStyle={styles.overlayScrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.topBar}>
            <Text style={styles.title}>SENTINEL</Text>
            <StatusPill ready={initialized} />
            <TouchableOpacity style={styles.resetBtn} onPress={handleReset}>
              <Text style={styles.resetBtnText}>Reset</Text>
            </TouchableOpacity>
          </View>

          <View style={{ flex: 1 }} pointerEvents="none" />

          <View pointerEvents="auto">
            <ScoreDashboard scores={scores} mode={liveMode} initialized={initialized} />
            <SessionControls
              state={sessionState}
              patient={patient}
              currentExercise={currentExercise}
              exerciseIdx={exerciseIdx}
              timeLeft={timeLeft}
              onStartSession={startSession}
              onStartExercise={startCurrentExercise}
              onStop={stopSessionEarly}
              onStartAnotherSession={startSession}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION CONTROLS
// ─────────────────────────────────────────────────────────────────────────────

function SessionControls({
  state, patient, currentExercise, exerciseIdx, timeLeft,
  onStartSession, onStartExercise, onStop, onStartAnotherSession,
}: {
  state:           SessionState;
  patient:         PatientInfo | null;
  currentExercise: ExerciseType | null;
  exerciseIdx:     number;
  timeLeft:        number;
  onStartSession:  () => void;
  onStartExercise: () => void;
  onStop:          () => void;
  onStartAnotherSession: () => void;
}) {
  if (state === 'analyzing') {
    return (
      <View style={styles.controlBar}>
        <Text style={styles.analyzingText}>Analyzing session…</Text>
      </View>
    );
  }

  if (state === 'done') {
    return (
      <View style={styles.promptBar}>
        <Text style={styles.promptTitle}>Session complete</Text>
        <Text style={styles.subtle}>
          One full session includes 2 squats, 2 step-downs, and walking.
        </Text>
        <TouchableOpacity style={styles.startBtn} onPress={onStartAnotherSession}>
          <Text style={styles.startBtnText}>⬤  Start Another Session</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (state === 'recording' && currentExercise) {
    return (
      <View style={styles.controlBar}>
        <View style={styles.countdownBadge}>
          <Text style={styles.countdownText}>{timeLeft}s</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.recordingLabel}>Recording: {EXERCISE_LABELS[currentExercise]}</Text>
          {patient && (
            <Text style={styles.subtle}>
              {exerciseIdx + 1} of {patient.curr_program.length}
            </Text>
          )}
        </View>
        <TouchableOpacity style={styles.stopBtn} onPress={onStop}>
          <Text style={styles.stopBtnText}>■ Stop</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (state === 'awaiting' && currentExercise && patient) {
    return (
      <View style={styles.promptBar}>
        <Text style={styles.subtle}>
          Next ({exerciseIdx + 1}/{patient.curr_program.length})
        </Text>
        <Text style={styles.promptTitle}>{EXERCISE_LABELS[currentExercise]}</Text>
        <Text style={styles.subtle}>Get into position. 30s recording.</Text>
        <TouchableOpacity style={styles.startBtn} onPress={onStartExercise}>
          <Text style={styles.startBtnText}>⬤  Start</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // idle
  if (!patient) {
    return (
      <View style={styles.controlBar}>
        <Text style={styles.subtle}>Loading patient info…</Text>
      </View>
    );
  }
  return (
    <View style={styles.promptBar}>
      <Text style={styles.subtle}>Patient {patient.patientId} — {patient.curr_program.length} exercises</Text>
      <TouchableOpacity style={styles.startBtn} onPress={onStartSession}>
        <Text style={styles.startBtnText}>⬤  Start Session</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS PILL
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
  overlayScroll: { flex: 1 },
  overlayScrollContent: { flexGrow: 1 },

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

  controlBar: {
    backgroundColor: 'rgba(13,27,42,0.92)',
    paddingHorizontal: 12, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderTopWidth: 1, borderTopColor: C.border,
    paddingBottom: Platform.OS === 'ios' ? 18 : 14,
  },
  promptBar: {
    backgroundColor: 'rgba(13,27,42,0.94)',
    paddingHorizontal: 16, paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: C.border,
    paddingBottom: Platform.OS === 'ios' ? 18 : 14,
    gap: 6,
  },
  promptTitle:    { color: '#fff', fontSize: 18, fontWeight: '700' },
  subtle:         { color: C.muted, fontSize: 12 },
  startBtn: {
    marginTop: 6, backgroundColor: 'rgba(0,212,255,0.10)',
    borderWidth: 1, borderColor: C.accent,
    borderRadius: 10, paddingVertical: 12, alignItems: 'center',
  },
  startBtnText:   { color: C.accent, fontSize: 14, fontWeight: '700' },

  countdownBadge: { backgroundColor: '#f44336', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minWidth: 48, alignItems: 'center' },
  countdownText:  { color: '#fff', fontSize: 16, fontWeight: '800' },
  recordingLabel: { color: '#f44336', fontSize: 13, fontWeight: '700' },
  stopBtn:        { backgroundColor: 'rgba(244,67,54,0.15)', borderWidth: 1, borderColor: '#f44336', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  stopBtnText:    { color: '#f44336', fontSize: 13, fontWeight: '700' },
  analyzingText:  { flex: 1, color: C.accent, fontSize: 13, fontWeight: '600', textAlign: 'center' },
});
