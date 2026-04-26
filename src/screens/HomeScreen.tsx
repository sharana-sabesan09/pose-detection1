import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import {
  fetchLatestReport,
  fetchPatientOverview,
} from '../engine/backendClient';
import { loadPatientInfo, PatientInfo } from '../engine/patientInfo';
import { loadStoredProfile } from '../engine/profileStorage';
import type { UserProfile } from '../types';
import Svg, { Path } from 'react-native-svg';
import {
  DoctorIcon,
  MovementsIcon,
  PaperBackground,
  ReturnIcon,
  SketchBox,
  SketchCircle,
  Squiggle,
} from '../sentinel/primitives';
import {
  COLORS,
  FONTS,
  greetingForNow,
} from '../sentinel/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

type LatestReport = {
  summary: string;
  session_highlights: string[];
  recommendations: string[];
} | null;

export default function HomeScreen({ navigation }: Props) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [patientInfo, setPatientInfo] = useState<PatientInfo | null>(null);
  const [latestReport, setLatestReport] = useState<LatestReport>(null);
  const [reinjuryRisk, setReinjuryRisk] = useState<number | null>(null);
  const [sessionCount, setSessionCount] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    const [storedProfile, patient] = await Promise.all([
      loadStoredProfile(),
      loadPatientInfo().catch(() => null),
    ]);

    setProfile(storedProfile);
    setPatientInfo(patient);

    if (!storedProfile?.patientId) {
      setLatestReport(null);
      setReinjuryRisk(null);
      setSessionCount(null);
      return;
    }

    try {
      const overview = await fetchPatientOverview(storedProfile.patientId);
      setReinjuryRisk(
        overview.accumulated_scores?.reinjury_risk_avg != null
          ? Math.round(overview.accumulated_scores.reinjury_risk_avg)
          : null,
      );
      setSessionCount(overview.session_count ?? 0);
    } catch {
      setReinjuryRisk(null);
      setSessionCount(null);
    }

    try {
      setLatestReport(await fetchLatestReport(storedProfile.patientId));
    } catch {
      setLatestReport(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const greeting = greetingForNow();
  const displayName = profile?.name || 'friend';
  const initial = displayName.slice(0, 1).toUpperCase();
  const movementCount = useMemo(() => {
    return patientInfo?.curr_program?.length ?? 0;
  }, [patientInfo]);
  const completedDots = Math.max(0, Math.min(12, sessionCount ?? 0));

  return (
    <View style={styles.root}>
      <PaperBackground />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topRow}>
          <View>
            <Text style={styles.greeting}>{greeting},</Text>
            <Text style={styles.name}>{displayName}.</Text>
            <Squiggle width={150} style={styles.squiggle} />
          </View>

          <Pressable
            onPress={() => navigation.navigate('Profile')}
            style={styles.profileButton}
          >
            <SketchCircle
              size={50}
              seed={5}
              fill="rgba(28,38,50,0.06)"
              stroke={COLORS.ink}
              strokeWidth={1.8}
            >
              <Text style={styles.profileInitial}>{initial}</Text>
            </SketchCircle>
          </Pressable>
        </View>

        <View style={styles.primaryCardWrap}>
          <Pressable onPress={() => navigation.navigate('Session')}>
            <SketchBox
              seed={3}
              style={styles.primaryCard}
              fill={COLORS.ink}
              stroke={COLORS.ink}
              strokeWidth={2}
            >
              <View>
                <Text style={styles.todayLabel}>TODAY'S</Text>
                <Text style={styles.startTitle}>Start a session</Text>
                <View style={styles.ctaFooter}>
                  <SketchCircle
                    size={36}
                    seed={9}
                    stroke={COLORS.paper}
                    fill="rgba(243,236,219,0.08)"
                  >
                    <Text style={styles.playIcon}>{'>'}</Text>
                  </SketchCircle>
                  <Text style={styles.ctaMeta}>
                    {movementCount > 0
                      ? `~12 min - ${movementCount} movements ready`
                      : '~12 min - session ready'}
                  </Text>
                </View>
              </View>
            </SketchBox>
          </Pressable>
        </View>

        <View style={styles.metricsGrid}>
          <SketchBox
            seed={14}
            style={styles.metricCard}
            fill="rgba(255,250,235,0.5)"
          >
            <Text style={styles.metricMicro}>RE-INJURY RISK</Text>
            <View style={styles.metricValueRow}>
              <Text style={[styles.metricBig, { color: COLORS.accent }]}>
                {reinjuryRisk != null ? reinjuryRisk : '--'}
                {reinjuryRisk != null ? (
                  <Text style={styles.metricPercent}>%</Text>
                ) : null}
              </Text>
            </View>
            <Text style={styles.metricSmall}>
              {reinjuryRisk != null ? 'from recorded sessions' : 'Awaiting scored sessions'}
            </Text>
          </SketchBox>

          <SketchBox
            seed={28}
            style={styles.metricCard}
            fill="rgba(255,250,235,0.5)"
          >
            <Text style={styles.metricMicro}>SESSIONS RECORDED</Text>
            <View style={styles.metricValueRow}>
              <Text style={styles.metricBig}>{sessionCount != null ? sessionCount : '--'}</Text>
              {sessionCount != null ? (
                <Text style={styles.metricSlash}>on record</Text>
              ) : null}
            </View>
            <View style={styles.dotRow}>
              {Array.from({ length: 12 }).map((_, index) => (
                <SketchCircle
                  key={`dot-${index}`}
                  size={12}
                  seed={40 + index}
                  stroke={COLORS.ink}
                  fill={index < completedDots ? COLORS.ink : 'transparent'}
                  strokeWidth={1.2}
                />
              ))}
            </View>
          </SketchBox>
        </View>

        <Text style={styles.exploreLabel}>EXPLORE</Text>

        <NavCard
          title="See all movements"
          subtitle="Browse the available exercise library"
          icon={<MovementsIcon />}
          seed={55}
          onPress={() => navigation.navigate('Movements')}
        />
        <NavCard
          title="Clinical report"
          subtitle={
            latestReport?.summary
              ? 'Latest grounded session note available'
              : 'No grounded report available yet'
          }
          icon={<DoctorIcon />}
          seed={61}
          accent
          onPress={() => navigation.navigate('DoctorReview')}
        />
        <NavCard
          title="Return after session"
          subtitle="Log how it felt, pain, and notes"
          icon={<ReturnIcon />}
          seed={68}
          onPress={() => navigation.navigate('Return')}
        />

        <View style={styles.footer}>
          <Text style={styles.footerText}>session metrics appear here after recorded visits</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function NavCard({
  title,
  subtitle,
  icon,
  seed,
  accent,
  onPress,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  seed: number;
  accent?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.navCardPressable}>
      <SketchBox
        seed={seed}
        style={styles.navCard}
        fill={accent ? 'rgba(236, 213, 201, 0.50)' : 'rgba(255,250,235,0.45)'}
        strokeWidth={1.5}
      >
        <View style={styles.navRow}>
          <View>{icon}</View>
          <View style={styles.flex}>
            <Text style={styles.navTitle}>{title}</Text>
            <Text style={styles.navSubtitle}>{subtitle}</Text>
          </View>
          <Svg width={20} height={20} viewBox="0 0 24 24">
            <Path d="M8 4 Q 17 11, 20 12 Q 17 13, 8 20" stroke={COLORS.ink} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </View>
      </SketchBox>
    </Pressable>
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
  content: {
    paddingHorizontal: 22,
    paddingTop: 60,
    paddingBottom: 30,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  greeting: {
    fontFamily: FONTS.hand,
    fontSize: 14,
    color: COLORS.ink3,
  },
  name: {
    fontFamily: FONTS.display,
    fontSize: 38,
    lineHeight: 40,
    color: COLORS.ink,
    transform: [{ rotate: '-1deg' }],
  },
  squiggle: {
    marginTop: 4,
  },
  profileButton: {},
  profileInitial: {
    fontFamily: FONTS.display,
    fontSize: 22,
    color: COLORS.ink,
  },
  primaryCardWrap: {
    marginTop: 22,
    position: 'relative',
  },
  primaryCard: {
    paddingHorizontal: 22,
    paddingVertical: 22,
  },
  todayLabel: {
    fontFamily: FONTS.hand,
    fontSize: 13,
    color: 'rgba(243,236,219,0.70)',
    letterSpacing: 1,
  },
  startTitle: {
    marginTop: 2,
    fontFamily: FONTS.display,
    fontSize: 42,
    lineHeight: 42,
    color: COLORS.paper,
  },
  ctaFooter: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  playIcon: {
    color: COLORS.paper,
    fontSize: 18,
    marginTop: -2,
    marginLeft: 1,
  },
  ctaMeta: {
    flex: 1,
    fontFamily: FONTS.hand,
    fontSize: 14,
    color: 'rgba(243,236,219,0.85)',
  },
  metricsGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  metricCard: {
    flex: 1,
    padding: 14,
  },
  metricMicro: {
    fontFamily: FONTS.hand,
    fontSize: 11,
    letterSpacing: 1.2,
    color: COLORS.ink3,
  },
  metricValueRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  metricBig: {
    fontFamily: FONTS.display,
    fontSize: 36,
    lineHeight: 36,
    color: COLORS.ink,
  },
  metricPercent: {
    fontFamily: FONTS.hand,
    fontSize: 18,
    color: COLORS.ink3,
  },
  metricSlash: {
    fontFamily: FONTS.hand,
    fontSize: 13,
    color: COLORS.ink3,
  },
  metricSmall: {
    marginTop: 2,
    fontFamily: FONTS.hand,
    fontSize: 11,
    color: COLORS.ink3,
  },
  dotRow: {
    marginTop: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  exploreLabel: {
    marginTop: 24,
    marginBottom: 8,
    fontFamily: FONTS.hand,
    fontSize: 12,
    color: COLORS.ink3,
    letterSpacing: 1.5,
  },
  navCardPressable: {
    marginBottom: 10,
  },
  navCard: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  navTitle: {
    fontFamily: FONTS.display,
    fontSize: 24,
    lineHeight: 26,
    color: COLORS.ink,
  },
  navSubtitle: {
    marginTop: 2,
    fontFamily: FONTS.hand,
    fontSize: 13,
    color: COLORS.ink3,
  },
  footer: {
    marginTop: 26,
    paddingBottom: 8,
    alignItems: 'center',
  },
  footerText: {
    fontFamily: FONTS.hand,
    fontSize: 13,
    color: COLORS.inkFaint,
    textAlign: 'center',
  },
});
