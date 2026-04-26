import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import Voice from '@react-native-voice/voice';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { upsertPatientProfile } from '../engine/backendClient';
import {
  generatePatientId,
  loadStoredProfile,
  saveStoredProfile,
} from '../engine/profileStorage';
import type { PTRecordSummary, UserProfile } from '../types';
import {
  BodyDiagram,
  BodyMini,
  CheckMark,
  FieldLabel,
  InkButton,
  OnboardingShell,
  PaperBackground,
  RecordIcon,
  SketchBox,
  SketchCircle,
  SketchInput,
  Squiggle,
  TagPill,
  TalkIcon,
} from '../sentinel/primitives';
import {
  calcBMI,
  calcDemographicRisk,
  COLORS,
  COMMON_CONTRAS,
  COMMON_RESTRICTS,
  DIAGNOSIS_SUGGEST,
  FONTS,
  prettyJoint,
  REHAB_PHASES,
} from '../sentinel/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Onboarding'>;

type DraftState = {
  age: string;
  gender: 'male' | 'female' | 'other' | '';
  heightCm: string;
  weightKg: string;
  injured_joints: string[];
  injured_side: 'left' | 'right' | 'bilateral' | 'unknown';
  rehab_phase: UserProfile['rehab_phase'];
  diagnosis: string;
  contraindications: string[];
  restrictions: string[];
  restrictionOther: string;
  doctorName: string;
  doctorEmail: string;
  ptRecords: PTRecordSummary[];
  ptRecordsNote: string;
};

const TOTAL_STEPS = 7;

function createDraft(profile?: UserProfile | null): DraftState {
  return {
    age: profile?.age ? String(profile.age) : '',
    gender: profile?.gender ?? '',
    heightCm: profile?.heightCm ? String(profile.heightCm) : '',
    weightKg: profile?.weightKg ? String(profile.weightKg) : '',
    injured_joints: profile?.injured_joints ?? [],
    injured_side: profile?.injured_side ?? 'unknown',
    rehab_phase: profile?.rehab_phase ?? 'unknown',
    diagnosis: profile?.diagnosis ?? '',
    contraindications: profile?.contraindications ?? [],
    restrictions: profile?.restrictions ?? [],
    restrictionOther: '',
    doctorName: profile?.doctorName ?? '',
    doctorEmail: profile?.doctorEmail ?? '',
    ptRecords: profile?.ptRecords ?? [],
    ptRecordsNote: profile?.ptRecordsNote ?? '',
  };
}

export default function SentinelOnboardingScreen({ navigation, route }: Props) {
  const editMode = route.params?.mode === 'edit';
  const [step, setStep] = useState(0);
  const [existingProfile, setExistingProfile] = useState<UserProfile | null>(null);
  const [draft, setDraft] = useState<DraftState>(createDraft());
  const [talkOpen, setTalkOpen] = useState(false);

  useEffect(() => {
    loadStoredProfile().then(profile => {
      setExistingProfile(profile);
      if (profile) {
        setDraft(createDraft(profile));
      }
    });
  }, []);

  const bmi = useMemo(() => {
    const height = Number(draft.heightCm);
    const weight = Number(draft.weightKg);
    if (!height || !weight) return null;
    return calcBMI(height, weight).toFixed(1);
  }, [draft.heightCm, draft.weightKg]);

  const setDraftPatch = (patch: Partial<DraftState>) => {
    setDraft(current => ({ ...current, ...patch }));
  };

  const goBack = () => {
    if (step === 0) {
      if (editMode && navigation.canGoBack()) {
        navigation.goBack();
      }
      return;
    }
    setStep(current => Math.max(0, current - 1));
  };

  const goNext = () => {
    setStep(current => Math.min(7, current + 1));
  };

  const addRecord = () => {
    const record: PTRecordSummary = {
      id: `r_${Date.now()}`,
      name: `Record ${draft.ptRecords.length + 1}.pdf`,
      pages: 2 + (draft.ptRecords.length % 6),
      added: 'just now',
    };
    setDraftPatch({ ptRecords: [...draft.ptRecords, record] });
  };

  const removeRecord = (recordId: string) => {
    setDraftPatch({
      ptRecords: draft.ptRecords.filter(record => record.id !== recordId),
    });
  };

  const toggleJoint = (jointId: string) => {
    const normalized = jointId.replace('_r', '');
    const next = draft.injured_joints.includes(normalized)
      ? draft.injured_joints.filter(item => item !== normalized)
      : [...draft.injured_joints, normalized];
    setDraftPatch({ injured_joints: next });
  };

  const toggleListItem = (
    key: 'contraindications' | 'restrictions',
    value: string,
  ) => {
    const current = draft[key];
    setDraftPatch({
      [key]: current.includes(value)
        ? current.filter(item => item !== value)
        : [...current, value],
    } as Pick<DraftState, typeof key>);
  };

  const demographicsValid =
    Number(draft.age) >= 18 &&
    Number(draft.heightCm) >= 100 &&
    Number(draft.weightKg) >= 20 &&
    Boolean(draft.gender);

  const finishSetup = async () => {
    const age = Number.parseInt(draft.age, 10);
    const heightCm = Number.parseFloat(draft.heightCm);
    const weightKg = Number.parseFloat(draft.weightKg);

    if (!Number.isFinite(age) || age < 18 || age > 110) {
      Alert.alert('Invalid age', 'Please enter an age between 18 and 110.');
      setStep(1);
      return;
    }
    if (!Number.isFinite(heightCm) || heightCm < 100 || heightCm > 250) {
      Alert.alert('Invalid height', 'Please enter a height between 100 and 250 cm.');
      setStep(1);
      return;
    }
    if (!Number.isFinite(weightKg) || weightKg < 20 || weightKg > 300) {
      Alert.alert('Invalid weight', 'Please enter a weight between 20 and 300 kg.');
      setStep(1);
      return;
    }
    if (!draft.gender) {
      Alert.alert('Missing field', 'Please select a biological sex.');
      setStep(1);
      return;
    }

    const bmiValue = calcBMI(heightCm, weightKg);
    const restrictionOther = draft.restrictionOther.trim();
    const restrictions = restrictionOther
      ? Array.from(new Set([...draft.restrictions, restrictionOther]))
      : draft.restrictions;

    const profile: UserProfile = {
      patientId: existingProfile?.patientId ?? generatePatientId(),
      name: existingProfile?.name,
      age,
      gender: draft.gender,
      heightCm,
      weightKg,
      bmi: Math.round(bmiValue * 10) / 10,
      demographicRiskScore: calcDemographicRisk(age, draft.gender, bmiValue),
      injured_joints: draft.injured_joints,
      injured_side: draft.injured_side,
      rehab_phase: draft.rehab_phase,
      diagnosis: draft.diagnosis.trim(),
      contraindications: draft.contraindications,
      restrictions,
      doctorName: draft.doctorName.trim(),
      doctorEmail: draft.doctorEmail.trim(),
      ptRecords: draft.ptRecords,
      ptRecordsNote: draft.ptRecordsNote.trim(),
      backendProfileSyncedAt: existingProfile?.backendProfileSyncedAt,
    };

    try {
      await upsertPatientProfile(profile);
      profile.backendProfileSyncedAt = new Date().toISOString();
    } catch (error) {
      console.warn(
        '[SentinelOnboardingScreen] backend patient upsert failed:',
        (error as Error).message,
      );
    }

    await saveStoredProfile(profile);
    navigation.reset({
      index: 0,
      routes: [{ name: 'Home' }],
    });
  };

  if (step === 0) {
    return (
      <View style={styles.root}>
        <PaperBackground />
        <ScrollView
          contentContainerStyle={styles.welcomeContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.welcomeCenter}>
            <Text style={styles.brand}>Sentinel</Text>
            <View style={styles.centeredSquiggle}>
              <Squiggle width={140} />
            </View>
            <Text style={styles.welcomeTagline}>
              a quiet companion for the{'\n'}days between visits.
            </Text>
          </View>

          <View style={styles.heroIllustration}>
            <SvgHero />
          </View>

          <SketchBox
            seed={11}
            style={styles.welcomeCallout}
            fill="rgba(255,250,235,0.5)"
          >
            <Text style={styles.helperCopy}>
              A few questions to set up your record.{'\n'}
              Most are optional - your therapist can fill in the rest.
            </Text>
          </SketchBox>

          <InkButton
            label={editMode ? 'Update your record ->' : "Let's begin ->"}
            onPress={goNext}
            style={styles.fullButton}
          />
          <Text style={styles.welcomeFoot}>takes about 3 minutes</Text>
        </ScrollView>
      </View>
    );
  }

  if (step === 1) {
    return (
      <View style={styles.root}>
        <OnboardingShell step={1} total={TOTAL_STEPS} onBack={goBack} title="About you">
          <Text style={styles.bodyCopy}>
            Used to set a baseline. Stays on this device + your patient record.
          </Text>

          <FieldBlock label="Age">
            <SketchInput
              keyboardType="number-pad"
              placeholder="68"
              value={draft.age}
              onChangeText={age => setDraftPatch({ age })}
              suffix="years"
            />
          </FieldBlock>

          <FieldBlock label="Biological sex">
            <View style={styles.pillRow}>
              {(['male', 'female', 'other'] as const).map(gender => (
                <Pressable
                  key={gender}
                  style={styles.flex}
                  onPress={() => setDraftPatch({ gender })}
                >
                  <TagPill
                    label={gender.charAt(0).toUpperCase() + gender.slice(1)}
                    active={draft.gender === gender}
                    style={styles.fullPill}
                  />
                </Pressable>
              ))}
            </View>
          </FieldBlock>

          <View style={styles.dualFieldRow}>
            <FieldBlock label="Height" style={styles.flex}>
              <SketchInput
                keyboardType="decimal-pad"
                placeholder="165"
                value={draft.heightCm}
                onChangeText={heightCm => setDraftPatch({ heightCm })}
                suffix="cm"
              />
            </FieldBlock>
            <FieldBlock label="Weight" style={styles.flex}>
              <SketchInput
                keyboardType="decimal-pad"
                placeholder="72"
                value={draft.weightKg}
                onChangeText={weightKg => setDraftPatch({ weightKg })}
                suffix="kg"
              />
            </FieldBlock>
          </View>

          {bmi ? (
            <SketchBox
              seed={22}
              style={styles.bmiBox}
              fill="rgba(255,250,235,0.55)"
            >
              <View style={styles.bmiRow}>
                <Text style={styles.metricLabel}>BMI</Text>
                <Text style={styles.metricValue}>{bmi}</Text>
              </View>
            </SketchBox>
          ) : null}

          <BottomNext disabled={!demographicsValid} onPress={goNext} />
        </OnboardingShell>
      </View>
    );
  }

  if (step === 2) {
    return (
      <View style={styles.root}>
        <OnboardingShell
          step={2}
          total={TOTAL_STEPS}
          onBack={goBack}
          title="Past PT records"
        >
          <Text style={styles.bodyCopy}>
            Drop in any prior PT notes, scans, or summaries. We'll use them to seed
            your plan.
          </Text>

          <Pressable onPress={addRecord}>
            <SketchBox
              seed={140}
              style={styles.appendBox}
              fill="rgba(255,250,235,0.5)"
              double
            >
              <View style={styles.recordRow}>
                <SketchCircle size={50} seed={141} fill="rgba(28,38,50,0.05)">
                  <Text style={styles.addRecord}>+</Text>
                </SketchCircle>
                <View style={styles.flex}>
                  <Text style={styles.cardTitle}>Append a record</Text>
                  <Text style={styles.cardSub}>PDF · photo · doctor's letter</Text>
                </View>
              </View>
            </SketchBox>
          </Pressable>

          {draft.ptRecords.length > 0 ? (
            <View style={styles.recordsBlock}>
              <Text style={styles.microLabel}>APPENDED ({draft.ptRecords.length})</Text>
              {draft.ptRecords.map((record, index) => (
                <View key={record.id} style={styles.recordItem}>
                  <SketchBox
                    seed={150 + index * 4}
                    style={styles.recordCard}
                    fill="rgba(255,250,235,0.45)"
                  >
                    <View style={styles.recordItemRow}>
                      <RecordIcon />
                      <View style={styles.flex}>
                        <Text style={styles.recordName}>{record.name}</Text>
                        <Text style={styles.recordMeta}>
                          {record.pages} pages · added {record.added}
                        </Text>
                      </View>
                      <Pressable onPress={() => removeRecord(record.id)} hitSlop={8}>
                        <Text style={styles.removeMark}>×</Text>
                      </Pressable>
                    </View>
                  </SketchBox>
                </View>
              ))}
            </View>
          ) : null}

          <FieldBlock label="Or jot a quick note">
            <SketchInput
              multiline
              placeholder="e.g. ACL repair Jan 2026 at City Ortho. PT 2x/week since Feb."
              value={draft.ptRecordsNote}
              onChangeText={ptRecordsNote => setDraftPatch({ ptRecordsNote })}
            />
          </FieldBlock>

          <View style={styles.buttonStack}>
            <InkButton label="Continue ->" onPress={goNext} style={styles.fullButton} />
            <Pressable onPress={goNext}>
              <Text style={styles.skipLink}>Skip - I'll add later</Text>
            </Pressable>
          </View>
        </OnboardingShell>
      </View>
    );
  }

  if (step === 3) {
    return (
      <View style={styles.root}>
        <OnboardingShell
          step={3}
          total={TOTAL_STEPS}
          onBack={goBack}
          title="Where does it hurt?"
        >
          <Text style={styles.bodyCopy}>Tap the joints involved in your injury.</Text>
          <View style={styles.bodyDiagramWrap}>
            <View style={styles.bodyDiagramFrame}>
              <BodyDiagram
                selected={draft.injured_joints}
                side={draft.injured_side}
                onToggle={toggleJoint}
              />
            </View>
            <View style={styles.bodyAnnotation}>
              <Text style={styles.annotationText}>tap any joint</Text>
              <Squiggle width={70} />
            </View>
          </View>
          <View style={styles.selectionBlock}>
            <Text style={styles.microLabel}>SELECTED ({draft.injured_joints.length})</Text>
            <View style={styles.tagWrap}>
              {draft.injured_joints.length === 0 ? (
                <Text style={styles.noneYet}>none yet</Text>
              ) : (
                draft.injured_joints.map(joint => (
                  <TagPill key={joint} label={prettyJoint(joint)} accent />
                ))
              )}
            </View>
          </View>
          <BottomNext onPress={goNext} hint="optional" />
        </OnboardingShell>
      </View>
    );
  }

  if (step === 4) {
    return (
      <View style={styles.root}>
        <OnboardingShell step={4} total={TOTAL_STEPS} onBack={goBack} title="Which side?">
          <Text style={styles.bodyCopy}>
            Helps us read your camera data correctly.
          </Text>
          <View style={styles.sideGrid}>
            {(['left', 'right'] as const).map(side => (
              <Pressable
                key={side}
                style={styles.flex}
                onPress={() => setDraftPatch({ injured_side: side })}
              >
                <ChoiceCard active={draft.injured_side === side}>
                  <BodyMini side={side} />
                  <Text style={styles.choiceLabel}>
                    {side.charAt(0).toUpperCase() + side.slice(1)}
                  </Text>
                </ChoiceCard>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={() => setDraftPatch({ injured_side: 'bilateral' })}>
            <ChoiceCard active={draft.injured_side === 'bilateral'} horizontal>
              <BodyMini side="bilateral" small />
              <View>
                <Text style={styles.choiceLabel}>Bilateral</Text>
                <Text style={styles.cardSub}>Both sides affected</Text>
              </View>
            </ChoiceCard>
          </Pressable>
          <BottomNext
            onPress={goNext}
            disabled={draft.injured_side === 'unknown'}
          />
        </OnboardingShell>
      </View>
    );
  }

  if (step === 5) {
    return (
      <View style={styles.root}>
        <OnboardingShell
          step={5}
          total={TOTAL_STEPS}
          onBack={goBack}
          title="Where in recovery?"
        >
          <Text style={styles.bodyCopy}>
            Your therapist may update this over time.
          </Text>
          <View style={styles.phaseList}>
            {REHAB_PHASES.map((phase, index) => {
              const active = draft.rehab_phase === phase.id;
              return (
                <Pressable
                  key={phase.id}
                  onPress={() => setDraftPatch({ rehab_phase: phase.id })}
                >
                  <SketchBox
                    seed={30 + index * 3}
                    style={styles.phaseCard}
                    fill={active ? 'rgba(28,38,50,0.06)' : 'rgba(255,250,235,0.4)'}
                    double={active}
                  >
                    <View style={styles.phaseRow}>
                      <View style={styles.phaseIndexWrap}>
                        <Text style={[styles.phaseIndex, active && styles.phaseIndexActive]}>
                          {index + 1}
                        </Text>
                      </View>
                      <View style={styles.flex}>
                        <Text style={styles.phaseTitle}>{phase.label}</Text>
                        <Text style={styles.cardSub}>{phase.sub}</Text>
                      </View>
                      {active ? <CheckMark size={20} /> : null}
                    </View>
                  </SketchBox>
                </Pressable>
              );
            })}
          </View>
          <BottomNext
            onPress={goNext}
            disabled={draft.rehab_phase === 'unknown'}
          />
        </OnboardingShell>
      </View>
    );
  }

  if (step === 6) {
    return (
      <View style={styles.root}>
        <OnboardingShell
          step={6}
          total={TOTAL_STEPS}
          onBack={goBack}
          title="Let's talk about it"
        >
          <Text style={styles.bodyCopy}>
            Tell us what your clinician said - diagnosis, things to avoid, and
            any limits. All optional.
          </Text>

          <ClinicalVoiceSession
            draft={draft}
            setDraftPatch={setDraftPatch}
            toggleListItem={toggleListItem}
          />
          <View style={styles.buttonStack}>
            <InkButton label="Continue ->" onPress={goNext} style={styles.fullButton} />
            <Pressable onPress={goNext}>
              <Text style={styles.skipLink}>
                Skip - I'll talk about it after onboarding
              </Text>
            </Pressable>
          </View>
        </OnboardingShell>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <OnboardingShell
        step={7}
        total={TOTAL_STEPS}
        onBack={goBack}
        title="Link your clinician"
      >
        <Text style={styles.bodyCopy}>
          So they see your sessions and can write notes back to you.
        </Text>
        <FieldBlock label="Clinician code or email">
          <SketchInput
            placeholder="dr.adler@clinic.org"
            value={draft.doctorEmail}
            onChangeText={doctorEmail => setDraftPatch({ doctorEmail })}
          />
        </FieldBlock>
        <FieldBlock label="Their name (optional)">
          <SketchInput
            placeholder="Dr. Adler"
            value={draft.doctorName}
            onChangeText={doctorName => setDraftPatch({ doctorName })}
          />
        </FieldBlock>
        <SketchBox
          seed={91}
          style={styles.doctorCallout}
          fill="rgba(255,250,235,0.55)"
        >
          <View style={styles.recordRow}>
            <SketchCircle size={42} seed={92} fill="rgba(28,38,50,0.06)">
              <Text style={styles.calloutGlyph}>✎</Text>
            </SketchCircle>
            <Text style={styles.calloutText}>
              You can skip this and add a clinician later from your profile.
            </Text>
          </View>
        </SketchBox>

        <BottomNext
          label="Finish setup ->"
          onPress={finishSetup}
          hint="optional"
        />
      </OnboardingShell>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CLINICAL VOICE SESSION — "Talk about it" mic-driven intake
// ─────────────────────────────────────────────────────────────────────────────

function parseClinicalTranscript(text: string): Partial<DraftState> {
  const lower = text.toLowerCase();
  const patch: Partial<DraftState> = {};

  // Diagnosis: check known conditions first, then free-form capture
  for (const d of DIAGNOSIS_SUGGEST) {
    if (lower.includes(d.toLowerCase())) {
      patch.diagnosis = d;
      break;
    }
  }
  if (!patch.diagnosis) {
    const m = lower.match(/(?:i have|my diagnosis is|diagnosed with|diagnosis:?)\s+([^,.]+)/);
    if (m) patch.diagnosis = m[1].trim();
  }

  // Contraindications: keyword overlap with known list
  const contras = COMMON_CONTRAS.filter(c => {
    const words = c.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    return words.some(w => lower.includes(w));
  });
  if (contras.length > 0) patch.contraindications = contras;

  // Restrictions: keyword overlap with known list
  const rests = COMMON_RESTRICTS.filter(r => {
    const words = r.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    return words.some(w => lower.includes(w));
  });
  if (rests.length > 0) patch.restrictions = rests;

  return patch;
}

type VoiceState = 'idle' | 'listening' | 'done';

function ClinicalVoiceSession({
  draft,
  setDraftPatch,
  toggleListItem,
}: {
  draft: DraftState;
  setDraftPatch: (p: Partial<DraftState>) => void;
  toggleListItem: (key: 'contraindications' | 'restrictions', value: string) => void;
}) {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [partialText, setPartialText] = useState('');
  const [showForm, setShowForm] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    Voice.onSpeechPartialResults = e => {
      setPartialText(e.value?.[0] ?? '');
    };
    Voice.onSpeechResults = e => {
      const transcript = e.value?.[0] ?? '';
      const extracted = parseClinicalTranscript(transcript);
      setDraftPatch(extracted);
      setPartialText(transcript);
      setVoiceState('done');
    };
    Voice.onSpeechError = () => {
      setVoiceState('idle');
      stopPulse();
    };
    return () => {
      Voice.destroy().catch(() => {});
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startPulse = () => {
    pulseLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.25, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    pulseLoop.current.start();
  };

  const stopPulse = () => {
    pulseLoop.current?.stop();
    pulseAnim.setValue(1);
  };

  const startListening = async () => {
    try {
      setPartialText('');
      setVoiceState('listening');
      startPulse();
      await Voice.start('en-US');
    } catch {
      setVoiceState('idle');
      stopPulse();
      Alert.alert('Microphone unavailable', 'Make sure Sentinel has microphone permission.');
    }
  };

  const stopListening = async () => {
    try {
      await Voice.stop();
    } catch { /* ignore */ }
    stopPulse();
  };

  const isListening = voiceState === 'listening';

  return (
    <View style={voiceStyles.wrap}>
      {/* Mic CTA card */}
      <Pressable onPress={isListening ? stopListening : startListening}>
        <SketchBox
          seed={170}
          style={voiceStyles.ctaBox}
          fill={isListening ? 'rgba(196,119,90,0.22)' : 'rgba(236,213,201,0.75)'}
          stroke={COLORS.accentDeep}
          strokeWidth={2}
          double={isListening}
        >
          <View style={voiceStyles.ctaRow}>
            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <SketchCircle
                size={52}
                seed={171}
                fill={isListening ? COLORS.accent : 'rgba(255,245,239,0.85)'}
                stroke={COLORS.accentDeep}
              >
                <TalkIcon />
              </SketchCircle>
            </Animated.View>
            <View style={voiceStyles.flex}>
              <Text style={voiceStyles.ctaTitle}>
                {isListening ? 'Listening...' : voiceState === 'done' ? 'Got it!' : 'Talk about it'}
              </Text>
              <Text style={[styles.cardSub, { color: COLORS.accentDeep }]}>
                {isListening
                  ? 'Tap to stop'
                  : voiceState === 'done'
                  ? 'Tap to re-record'
                  : 'diagnosis · avoid · limits'}
              </Text>
            </View>
            {voiceState !== 'listening' && (
              <Text style={voiceStyles.chevron}>〉</Text>
            )}
          </View>
        </SketchBox>
      </Pressable>

      {/* Live transcript bubble */}
      {(isListening || partialText !== '') ? (
        <SketchBox seed={172} style={voiceStyles.transcriptBox} fill="rgba(255,250,235,0.6)">
          <Text style={voiceStyles.transcriptText} numberOfLines={4}>
            {partialText || '...'}
          </Text>
        </SketchBox>
      ) : null}

      {/* Extracted fields summary + edit toggle */}
      {voiceState === 'done' ? (
        <View style={voiceStyles.resultWrap}>
          <SketchBox seed={195} style={styles.summaryBox} fill="rgba(255,250,235,0.5)">
            <Text style={styles.summaryLabel}>HEARD</Text>
            <Text style={styles.summaryText}>
              {draft.diagnosis || 'no diagnosis'} · {draft.contraindications.length} to avoid · {draft.restrictions.length} limits
            </Text>
          </SketchBox>
          <Pressable onPress={() => setShowForm(f => !f)} style={voiceStyles.editLink}>
            <Text style={voiceStyles.editLinkText}>{showForm ? 'hide editor' : 'review / edit fields'}</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Manual form (always shown if voice hasn't been used yet, or toggled) */}
      {(voiceState === 'idle' || showForm) ? (
        <View style={styles.talkDetails}>
          <View>
            <Text style={styles.microLabel}>① DIAGNOSIS</Text>
            <SketchInput
              multiline
              placeholder="e.g. ACL reconstruction (left)"
              value={draft.diagnosis}
              onChangeText={diagnosis => setDraftPatch({ diagnosis })}
            />
            <View style={styles.tagWrap}>
              {DIAGNOSIS_SUGGEST.slice(0, 5).map(item => (
                <TagPill key={item} label={item} onPress={() => setDraftPatch({ diagnosis: item })} />
              ))}
            </View>
          </View>
          <View>
            <Text style={styles.microLabel}>② TO AVOID</Text>
            <View style={styles.tagWrap}>
              {COMMON_CONTRAS.map(item => {
                const active = draft.contraindications.includes(item);
                return (
                  <TagPill
                    key={item}
                    label={`${active ? '⚠ ' : ''}${item}`}
                    active={active}
                    onPress={() => toggleListItem('contraindications', item)}
                    style={active ? styles.warningTag : undefined}
                  />
                );
              })}
            </View>
          </View>
          <View>
            <Text style={styles.microLabel}>③ LIMITS</Text>
            <View style={styles.tagWrap}>
              {COMMON_RESTRICTS.map(item => (
                <TagPill
                  key={item}
                  label={item}
                  active={draft.restrictions.includes(item)}
                  onPress={() => toggleListItem('restrictions', item)}
                />
              ))}
            </View>
            <View style={styles.mt8}>
              <SketchInput
                placeholder="Add your own limit..."
                value={draft.restrictionOther}
                onChangeText={restrictionOther => setDraftPatch({ restrictionOther })}
              />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const voiceStyles = StyleSheet.create({
  wrap: { gap: 12 },
  flex: { flex: 1 },
  ctaBox: { paddingHorizontal: 20, paddingVertical: 18 },
  ctaRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  ctaTitle: { fontFamily: FONTS.display, fontSize: 26, lineHeight: 28, color: COLORS.accentDeep },
  chevron: { fontSize: 28, color: COLORS.accentDeep },
  transcriptBox: { paddingHorizontal: 14, paddingVertical: 12, marginTop: 4 },
  transcriptText: { fontFamily: FONTS.hand, fontSize: 15, color: COLORS.ink2, lineHeight: 22 },
  resultWrap: { gap: 6 },
  editLink: { alignSelf: 'flex-start', paddingVertical: 4 },
  editLinkText: {
    fontFamily: FONTS.hand, fontSize: 13, color: COLORS.ink3,
    textDecorationLine: 'underline',
  },
});

function FieldBlock({
  label,
  children,
  style,
}: {
  label: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.fieldBlock, style]}>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </View>
  );
}

function BottomNext({
  label = 'Continue ->',
  onPress,
  disabled,
  hint,
}: {
  label?: string;
  onPress: () => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <View style={styles.bottomNext}>
      <InkButton
        label={label}
        onPress={onPress}
        disabled={disabled}
        style={styles.fullButton}
      />
      {hint ? <Text style={styles.bottomHint}>{hint}</Text> : null}
    </View>
  );
}

function ChoiceCard({
  active,
  children,
  horizontal,
}: {
  active: boolean;
  children: React.ReactNode;
  horizontal?: boolean;
}) {
  return (
    <SketchBox
      seed={active ? 88 : 22}
      style={styles.choiceCard}
      fill={active ? 'rgba(28,38,50,0.06)' : 'rgba(255,250,235,0.4)'}
      double={active}
    >
      <View
        style={[
          styles.choiceCardInner,
          horizontal ? styles.choiceCardInnerHorizontal : undefined,
        ]}
      >
        {children}
      </View>
    </SketchBox>
  );
}

function SvgHero() {
  return (
    <View>
      <Svg width="100%" height={220} viewBox="0 0 280 200">
        <Path d="M 10 175 Q 140 178, 270 175" stroke={COLORS.ink} strokeWidth="1.4" fill="none" />
        <Circle cx="120" cy="55" r="14" stroke={COLORS.ink} strokeWidth="1.6" fill="rgba(255,250,235,0.6)" />
        <Path d="M 120 70 L 120 130" stroke={COLORS.ink} strokeWidth="1.6" />
        <Path d="M 120 88 Q 105 100, 95 118" stroke={COLORS.ink} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <Path d="M 120 88 Q 138 95, 150 110" stroke={COLORS.ink} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <Path d="M 120 130 Q 110 150, 102 175" stroke={COLORS.ink} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <Path d="M 120 130 Q 132 152, 142 175" stroke={COLORS.ink} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <Path d="M 30 30 L 105 60" stroke={COLORS.ink} strokeWidth="1" strokeDasharray="3 4" fill="none" />
        <Path d="M 30 30 L 100 90" stroke={COLORS.ink} strokeWidth="1" strokeDasharray="3 4" fill="none" />
        <Rect x="14" y="18" width="22" height="16" rx="2" stroke={COLORS.ink} strokeWidth="1.4" fill="rgba(255,250,235,0.6)" />
        <Circle cx="25" cy="26" r="4" stroke={COLORS.ink} strokeWidth="1.4" fill="none" />
        <Path d="M 188 70 Q 175 80, 158 95" stroke={COLORS.ink} strokeWidth="1.2" fill="none" />
        <Path d="M 158 95 L 162 88 M 158 95 L 165 96" stroke={COLORS.ink} strokeWidth="1.2" fill="none" strokeLinecap="round" />
        <Path d="M 218 158 Q 230 170, 248 168" stroke={COLORS.ink} strokeWidth="1.2" fill="none" />
      </Svg>
      <Text style={[styles.heroAnnotation, styles.heroAnnotationTop]}>
        tracks how you move
      </Text>
      <Text style={[styles.heroAnnotation, styles.heroAnnotationBottom]}>
        flags re-injury risk
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.paper,
  },
  flex: {
    flex: 1,
  },
  welcomeContent: {
    paddingHorizontal: 22,
    paddingTop: 86,
    paddingBottom: 28,
  },
  welcomeCenter: {
    alignItems: 'center',
    paddingTop: 24,
  },
  brand: {
    fontFamily: FONTS.display,
    fontSize: 56,
    lineHeight: 58,
    color: COLORS.ink,
    transform: [{ rotate: '-2deg' }],
  },
  centeredSquiggle: {
    marginTop: 6,
  },
  welcomeTagline: {
    marginTop: 18,
    fontFamily: FONTS.handBold,
    fontSize: 18,
    lineHeight: 26,
    color: COLORS.ink2,
    textAlign: 'center',
  },
  heroIllustration: {
    marginTop: 36,
    position: 'relative',
  },
  heroAnnotation: {
    position: 'absolute',
    fontFamily: FONTS.display,
    fontSize: 18,
    color: COLORS.ink,
  },
  heroAnnotationTop: {
    top: 22,
    right: 8,
    transform: [{ rotate: '-4deg' }],
  },
  heroAnnotationBottom: {
    right: 0,
    bottom: 28,
    transform: [{ rotate: '-2deg' }],
  },
  welcomeCallout: {
    marginTop: 30,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  helperCopy: {
    fontFamily: FONTS.handBold,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.ink2,
  },
  fullButton: {
    width: '100%',
  },
  welcomeFoot: {
    marginTop: 12,
    textAlign: 'center',
    fontFamily: FONTS.hand,
    fontSize: 13,
    color: COLORS.ink3,
  },
  bodyCopy: {
    marginBottom: 18,
    fontFamily: FONTS.hand,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.ink2,
  },
  fieldBlock: {
    marginBottom: 16,
  },
  pillRow: {
    flexDirection: 'row',
    gap: 8,
  },
  fullPill: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  dualFieldRow: {
    flexDirection: 'row',
    gap: 12,
  },
  bmiBox: {
    marginTop: 6,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bmiRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metricLabel: {
    fontFamily: FONTS.hand,
    fontSize: 13,
    color: COLORS.ink3,
    letterSpacing: 1,
  },
  metricValue: {
    fontFamily: FONTS.display,
    fontSize: 26,
    color: COLORS.ink,
  },
  bottomNext: {
    marginTop: 28,
    marginBottom: 12,
  },
  bottomHint: {
    marginTop: 8,
    textAlign: 'center',
    fontFamily: FONTS.hand,
    fontSize: 12,
    color: COLORS.inkFaint,
  },
  appendBox: {
    paddingHorizontal: 18,
    paddingVertical: 22,
  },
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  addRecord: {
    fontFamily: FONTS.display,
    fontSize: 30,
    color: COLORS.ink,
    lineHeight: 30,
  },
  cardTitle: {
    fontFamily: FONTS.display,
    fontSize: 22,
    lineHeight: 24,
    color: COLORS.ink,
  },
  cardSub: {
    fontFamily: FONTS.hand,
    fontSize: 13,
    color: COLORS.ink3,
  },
  recordsBlock: {
    marginTop: 14,
  },
  microLabel: {
    marginBottom: 8,
    fontFamily: FONTS.hand,
    fontSize: 13,
    color: COLORS.ink3,
    letterSpacing: 1,
  },
  recordItem: {
    marginBottom: 8,
  },
  recordCard: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  recordItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  recordName: {
    fontFamily: FONTS.handBold,
    fontSize: 15,
    color: COLORS.ink,
  },
  recordMeta: {
    fontFamily: FONTS.hand,
    fontSize: 11,
    color: COLORS.ink3,
  },
  removeMark: {
    fontSize: 22,
    color: COLORS.inkFaint,
    lineHeight: 22,
  },
  buttonStack: {
    marginTop: 14,
    gap: 10,
  },
  skipLink: {
    paddingVertical: 8,
    textAlign: 'center',
    fontFamily: FONTS.hand,
    fontSize: 14,
    color: COLORS.ink3,
    textDecorationLine: 'underline',
  },
  bodyDiagramWrap: {
    alignItems: 'center',
    position: 'relative',
  },
  bodyDiagramFrame: {
    width: '100%',
    maxWidth: 240,
    alignItems: 'center',
  },
  bodyAnnotation: {
    position: 'absolute',
    top: 30,
    right: 0,
    transform: [{ rotate: '6deg' }],
  },
  annotationText: {
    fontFamily: FONTS.display,
    fontSize: 17,
    color: COLORS.ink3,
  },
  selectionBlock: {
    marginTop: 16,
  },
  tagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  noneYet: {
    fontFamily: FONTS.hand,
    fontSize: 14,
    color: COLORS.inkFaint,
  },
  sideGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  choiceCard: {
    width: '100%',
    paddingHorizontal: 14,
    paddingVertical: 20,
  },
  choiceCardInner: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  choiceCardInnerHorizontal: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    gap: 14,
  },
  choiceLabel: {
    fontFamily: FONTS.display,
    fontSize: 24,
    color: COLORS.ink,
  },
  phaseList: {
    gap: 10,
  },
  phaseCard: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  phaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  phaseIndexWrap: {
    width: 30,
    alignItems: 'center',
  },
  phaseIndex: {
    fontFamily: FONTS.display,
    fontSize: 28,
    color: COLORS.inkFaint,
  },
  phaseIndexActive: {
    color: COLORS.ink,
  },
  phaseTitle: {
    fontFamily: FONTS.display,
    fontSize: 24,
    color: COLORS.ink,
  },
  talkCta: {
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  talkTitle: {
    fontFamily: FONTS.display,
    fontSize: 26,
    lineHeight: 28,
    color: COLORS.accentDeep,
  },
  chevron: {
    fontSize: 28,
    color: COLORS.accentDeep,
  },
  talkDetails: {
    marginTop: 16,
    gap: 14,
  },
  mt8: {
    marginTop: 8,
  },
  warningTag: {
    borderColor: COLORS.bad,
    backgroundColor: COLORS.bad,
  },
  summaryBox: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  summaryLabel: {
    marginBottom: 4,
    fontFamily: FONTS.hand,
    fontSize: 12,
    color: COLORS.ink3,
    letterSpacing: 1,
  },
  summaryText: {
    fontFamily: FONTS.hand,
    fontSize: 13,
    color: COLORS.ink2,
    lineHeight: 18,
  },
  doctorCallout: {
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  calloutGlyph: {
    fontSize: 20,
    color: COLORS.ink,
  },
  calloutText: {
    flex: 1,
    fontFamily: FONTS.hand,
    fontSize: 13,
    color: COLORS.ink2,
    lineHeight: 18,
  },
});
