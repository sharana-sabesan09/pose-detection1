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
import Svg, { Circle, Path } from 'react-native-svg';
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
  labelForExercise,
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
  const [reinjuryRisk, setReinjuryRisk] = useState(14);
  const [sessionCount, setSessionCount] = useState(9);
  const [mood, setMood] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    const [storedProfile, patient] = await Promise.all([
      loadStoredProfile(),
      loadPatientInfo().catch(() => null),
    ]);

    setProfile(storedProfile);
    setPatientInfo(patient);

    if (!storedProfile?.patientId) {
      setLatestReport(null);
      setReinjuryRisk(14);
      setSessionCount(9);
      return;
    }

    try {
      const overview = await fetchPatientOverview(storedProfile.patientId);
      setReinjuryRisk(
        Math.round(overview.accumulated_scores?.reinjury_risk_avg ?? 14),
      );
      setSessionCount(overview.session_count || 9);
    } catch {
      setReinjuryRisk(14);
      setSessionCount(9);
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
  const weekday = new Date()
    .toLocaleDateString(undefined, { weekday: 'short' })
    .toUpperCase();
  const movementPreview = useMemo(() => {
    const program = patientInfo?.curr_program ?? ['leftLsd', 'walking'];
    return program.map(labelForExercise);
  }, [patientInfo]);

  const completedDots = Math.max(0, Math.min(12, sessionCount));

  return (
    <View style={styles.root}>
      <PaperBackground includeDoodles />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topRow}>
          <View>
            <Text style={styles.greeting}>{greeting},</Text>
            <Text style={styles.name}>
              {displayName}
              <Text style={styles.accentDot}>.</Text>
            </Text>
            <View style={styles.subRow}>
              <Squiggle width={120} color={COLORS.accent} />
              <Text style={styles.subtle}>day 24 of recovery</Text>
            </View>
          </View>

          <Pressable
            onPress={() => navigation.navigate('Profile')}
            style={styles.profileButton}
          >
            <SketchCircle
              size={54}
              seed={5}
              fill="rgba(242, 228, 176, 0.72)"
              stroke={COLORS.ink}
              strokeWidth={1.8}
            >
              <Text style={styles.profileInitial}>{initial}</Text>
            </SketchCircle>
            <View style={styles.profileBadge}>
              <SketchCircle
                size={16}
                seed={888}
                fill={COLORS.accent}
                stroke={COLORS.accentDeep}
                strokeWidth={1.4}
              >
                <Text style={styles.profileBadgeText}>2</Text>
              </SketchCircle>
            </View>
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
                <Text style={styles.todayLabel}>TODAY - {weekday}</Text>
                <Text style={styles.startTitle}>Start session</Text>
                <View style={styles.movementPreview}>
                  {movementPreview.slice(0, 2).map((label, index) => (
                    <View key={label} style={styles.previewItem}>
                      <View
                        style={[
                          styles.previewDot,
                          {
                            backgroundColor:
                              index === 0 ? COLORS.warm : 'rgba(243,236,219,0.45)',
                          },
                        ]}
                      />
                      <Text
                        style={[
                          styles.previewLabel,
                          { opacity: index === 0 ? 1 : 0.62 },
                        ]}
                      >
                        {label}
                      </Text>
                    </View>
                  ))}
                  <Text style={styles.previewLabelMuted}>
                    + {Math.max(0, movementPreview.length - 2)} more
                  </Text>
                </View>
                <View style={styles.ctaFooter}>
                  <SketchCircle
                    size={36}
                    seed={9}
                    stroke={COLORS.paper}
                    fill="rgba(243,236,219,0.08)"
                  >
                    <Text style={styles.playIcon}>▶</Text>
                  </SketchCircle>
                  <Text style={styles.ctaMeta}>~12 min - camera ready</Text>
                  <Text style={styles.ctaCount}>
                    {movementPreview.length}{' '}
                    <Text style={styles.ctaCountSmall}>moves</Text>
                  </Text>
                </View>
              </View>
            </SketchBox>
          </Pressable>
          <View style={styles.streakCard}>
            <SketchBox
              seed={777}
              style={styles.streakBox}
              fill={COLORS.warm}
              stroke={COLORS.warmDeep}
              strokeWidth={1.6}
            >
              <Text style={styles.streakText}>3-day streak *</Text>
            </SketchBox>
          </View>
        </View>

        <View style={styles.metricsGrid}>
          <SketchBox
            seed={14}
            style={styles.metricCard}
            fill="rgba(236, 213, 201, 0.58)"
            stroke={COLORS.accentDeep}
            strokeWidth={1.4}
          >
            <Text style={[styles.metricMicro, { color: COLORS.accentDeep }]}>
              RE-INJURY RISK
            </Text>
            <View style={styles.metricValueRow}>
              <Text style={[styles.metricBig, { color: COLORS.bad }]}>
                {reinjuryRisk}
                <Text style={styles.metricPercent}>%</Text>
              </Text>
            </View>
            <Svg
              width="100%"
              height={20}
              viewBox="0 0 100 20"
              preserveAspectRatio="none"
              style={{ marginTop: 4 }}
            >
              <Path
                d="M 2 6 Q 15 8, 25 12 T 50 9 T 75 14 T 98 16"
                stroke={COLORS.accent}
                strokeWidth="1.6"
                fill="none"
                strokeLinecap="round"
              />
              <Circle cx="98" cy="16" r="2.5" fill={COLORS.bad} />
            </Svg>
            <Text style={[styles.metricSmall, { color: COLORS.accentDeep }]}>
              down 3% this week
            </Text>
          </SketchBox>

          <SketchBox
            seed={28}
            style={styles.metricCard}
            fill="rgba(220, 233, 220, 0.64)"
            stroke={COLORS.greenDeep}
            strokeWidth={1.4}
          >
            <Text style={[styles.metricMicro, { color: COLORS.greenDeep }]}>
              SESSIONS DONE
            </Text>
            <View style={styles.metricValueRow}>
              <Text style={[styles.metricBig, { color: COLORS.greenDeep }]}>
                {sessionCount}
              </Text>
              <Text style={[styles.metricSlash, { color: COLORS.greenDeep }]}>/ 12</Text>
            </View>
            <View style={styles.dotRow}>
              {Array.from({ length: 12 }).map((_, index) => (
                <View
                  key={`session-dot-${index}`}
                  style={[
                    styles.progressDot,
                    index < completedDots && styles.progressDotFilled,
                  ]}
                />
              ))}
            </View>
          </SketchBox>
        </View>

        <SketchBox
          seed={222}
          style={styles.painStrip}
          fill="rgba(244, 231, 180, 0.58)"
          stroke={COLORS.warmDeep}
          strokeWidth={1.4}
        >
          <View style={styles.painStripRow}>
            <View style={styles.flex}>
              <Text style={[styles.metricMicro, { color: COLORS.warmDeep }]}>
                HOW'S YOUR KNEE TODAY?
              </Text>
              <Text style={[styles.painTap, { color: COLORS.warmDeep }]}>
                tap to log
              </Text>
            </View>
            <View style={styles.faceRow}>
              {['^_^', '-_-', 'o_o', '>_<'].map((face, index) => (
                <Pressable key={face} onPress={() => setMood(index)}>
                  <SketchCircle
                    size={32}
                    seed={300 + index}
                    stroke={COLORS.warmDeep}
                    fill={
                      mood === index
                        ? 'rgba(230, 198, 106, 0.6)'
                        : 'rgba(255, 249, 240, 0.72)'
                    }
                    strokeWidth={1.3}
                  >
                    <Text style={styles.faceText}>{face}</Text>
                  </SketchCircle>
                </Pressable>
              ))}
            </View>
          </View>
        </SketchBox>

        <View style={styles.exploreRow}>
          <Text style={styles.exploreLabel}>EXPLORE</Text>
          <Squiggle width={50} />
        </View>

        <NavCard
          title="See all movements"
          subtitle="Library of exercises in your plan"
          icon={<MovementsIcon />}
          seed={55}
          tint="blue"
          onPress={() => navigation.navigate('Movements')}
        />
        <NavCard
          title="Reviewed by your doctor"
          subtitle={
            latestReport?.summary
              ? 'Latest note synced from your care team'
              : '2 new notes from Dr. Adler'
          }
          icon={<DoctorIcon />}
          seed={61}
          tint="terracotta"
          badge={latestReport ? 'latest' : '2 new'}
          onPress={() => navigation.navigate('DoctorReview')}
        />
        <NavCard
          title="Return after session"
          subtitle="Log how it felt - pain - notes"
          icon={<ReturnIcon />}
          seed={68}
          tint="green"
          onPress={() => navigation.navigate('Return')}
        />

        <View style={styles.footer}>
          <Squiggle width={28} color={COLORS.accent} />
          <Text style={styles.footerText}>asking for help is the first step</Text>
          <Squiggle width={28} color={COLORS.accent} />
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
  tint,
  badge,
  onPress,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  seed: number;
  tint: 'blue' | 'green' | 'terracotta';
  badge?: string;
  onPress: () => void;
}) {
  const tintMap = {
    terracotta: {
      fill: 'rgba(236, 213, 201, 0.58)',
      stroke: COLORS.accentDeep,
    },
    green: {
      fill: 'rgba(220, 233, 220, 0.58)',
      stroke: COLORS.greenDeep,
    },
    blue: {
      fill: 'rgba(215, 224, 241, 0.62)',
      stroke: COLORS.blueDeep,
    },
  } as const;

  const colors = tintMap[tint];

  return (
    <Pressable onPress={onPress} style={styles.navCardPressable}>
      <SketchBox
        seed={seed}
        style={styles.navCard}
        fill={colors.fill}
        stroke={colors.stroke}
        strokeWidth={1.5}
      >
        <View style={styles.navRow}>
          <View>{icon}</View>
          <View style={styles.flex}>
            <Text style={styles.navTitle}>{title}</Text>
            <View style={styles.navSubRow}>
              <Text style={styles.navSubtitle}>{subtitle}</Text>
              {badge ? <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View> : null}
            </View>
          </View>
          <Text style={styles.navChevron}>〉</Text>
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
    fontSize: 40,
    lineHeight: 42,
    color: COLORS.ink,
    transform: [{ rotate: '-1deg' }],
  },
  accentDot: {
    color: COLORS.accent,
  },
  subRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  subtle: {
    fontFamily: FONTS.hand,
    fontSize: 12,
    color: COLORS.ink3,
  },
  profileButton: {
    position: 'relative',
  },
  profileInitial: {
    fontFamily: FONTS.display,
    fontSize: 24,
    color: COLORS.ink,
  },
  profileBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
  },
  profileBadgeText: {
    fontFamily: FONTS.display,
    fontSize: 10,
    color: COLORS.paper,
  },
  primaryCardWrap: {
    marginTop: 28,
    position: 'relative',
  },
  primaryCard: {
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 18,
  },
  todayLabel: {
    fontFamily: FONTS.hand,
    fontSize: 13,
    color: 'rgba(243,236,219,0.72)',
    letterSpacing: 1.5,
  },
  startTitle: {
    marginTop: 2,
    fontFamily: FONTS.display,
    fontSize: 42,
    lineHeight: 42,
    color: COLORS.paper,
  },
  movementPreview: {
    marginTop: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
  },
  previewItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  previewDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  previewLabel: {
    fontFamily: FONTS.hand,
    fontSize: 12,
    color: COLORS.paper,
  },
  previewLabelMuted: {
    fontFamily: FONTS.hand,
    fontSize: 12,
    color: 'rgba(243,236,219,0.55)',
  },
  ctaFooter: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  playIcon: {
    color: COLORS.paper,
    fontSize: 14,
    marginLeft: 1,
  },
  ctaMeta: {
    flex: 1,
    fontFamily: FONTS.hand,
    fontSize: 14,
    color: 'rgba(243,236,219,0.85)',
  },
  ctaCount: {
    fontFamily: FONTS.display,
    fontSize: 22,
    color: COLORS.warm,
  },
  ctaCountSmall: {
    fontFamily: FONTS.hand,
    fontSize: 11,
    color: 'rgba(243,236,219,0.72)',
  },
  streakCard: {
    position: 'absolute',
    top: -16,
    left: 14,
  },
  streakBox: {
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  streakText: {
    fontFamily: FONTS.display,
    fontSize: 16,
    color: '#4A3A18',
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
  },
  metricValueRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  metricBig: {
    fontFamily: FONTS.display,
    fontSize: 38,
    lineHeight: 38,
  },
  metricPercent: {
    fontFamily: FONTS.hand,
    fontSize: 16,
    color: COLORS.accentDeep,
  },
  metricSlash: {
    fontFamily: FONTS.hand,
    fontSize: 12,
  },
  metricSmall: {
    marginTop: 6,
    fontFamily: FONTS.hand,
    fontSize: 11,
  },
  dotRow: {
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  progressDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.1,
    borderColor: COLORS.greenDeep,
    backgroundColor: 'transparent',
  },
  progressDotFilled: {
    backgroundColor: COLORS.green,
  },
  painStrip: {
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  painStripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  painTap: {
    fontFamily: FONTS.display,
    fontSize: 18,
  },
  faceRow: {
    flexDirection: 'row',
    gap: 4,
  },
  faceText: {
    fontFamily: FONTS.display,
    fontSize: 13,
    color: COLORS.ink,
  },
  exploreRow: {
    marginTop: 24,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  exploreLabel: {
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
    fontSize: 22,
    lineHeight: 24,
    color: COLORS.ink,
  },
  navSubRow: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  navSubtitle: {
    fontFamily: FONTS.hand,
    fontSize: 13,
    color: COLORS.ink3,
  },
  badge: {
    borderRadius: 8,
    backgroundColor: COLORS.accent,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    fontFamily: FONTS.hand,
    fontSize: 10,
    color: COLORS.paper,
    letterSpacing: 0.5,
  },
  navChevron: {
    fontSize: 24,
    color: COLORS.ink,
  },
  footer: {
    marginTop: 28,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  footerText: {
    fontFamily: FONTS.hand,
    fontSize: 13,
    color: COLORS.inkFaint,
  },
});
