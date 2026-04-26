import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { loadPatientInfo } from '../engine/patientInfo';
import { CheckMark, PaperBackground, ScreenHeader, SketchBox, SketchCircle, TagPill } from '../sentinel/primitives';
import { COLORS, FONTS, movementMetaForExercise } from '../sentinel/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Movements'>;

type MovementItem = {
  id: number;
  title: string;
  joint: string;
  sets: string;
  difficulty: 'easy' | 'med' | 'hard';
  done?: boolean;
  today?: boolean;
};

export default function MovementsScreen({ navigation }: Props) {
  const [filter, setFilter] = useState<'all' | 'today' | 'knee' | 'hip' | 'ankle' | 'core' | 'gait'>('all');
  const [moves, setMoves] = useState<MovementItem[]>([]);

  React.useEffect(() => {
    loadPatientInfo()
      .then(patient => {
        const fromProgram = patient.curr_program.map((exercise, index) => {
          const meta = movementMetaForExercise(exercise);
          return {
            id: 100 + index,
            title: meta.title,
            joint: meta.joint,
            sets: meta.sets,
            difficulty: meta.difficulty,
            today: meta.today,
          } as MovementItem;
        });
        // Source of truth is the patient's curr_program — replace, don't merge.
        setMoves(fromProgram);
      })
      .catch(() => undefined);
  }, []);

  const filtered = useMemo(() => {
    if (filter === 'all') return moves;
    if (filter === 'today') return moves.filter(move => move.today);
    return moves.filter(move => move.joint === filter);
  }, [filter, moves]);

  return (
    <View style={styles.root}>
      <PaperBackground />
      <ScreenHeader
        onBack={() => navigation.goBack()}
        title="Movements"
        subtitle="your prescribed library"
      />
      <View style={styles.filterWrap}>
        {[
          ['all', 'All'],
          ['today', 'Today'],
          ['knee', 'Knee'],
          ['hip', 'Hip'],
          ['ankle', 'Ankle'],
          ['core', 'Core'],
          ['gait', 'Gait'],
        ].map(([value, label]) => (
          <TagPill
            key={value}
            label={label}
            active={filter === value}
            onPress={() => setFilter(value as typeof filter)}
          />
        ))}
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {filtered.map((move, index) => (
          <View key={move.id} style={styles.cardWrap}>
            <SketchBox
              seed={120 + index * 5}
              style={styles.card}
              fill={move.today ? 'rgba(236, 213, 201, 0.42)' : 'rgba(255,250,235,0.46)'}
            >
              <View style={styles.row}>
                <SketchCircle
                  size={42}
                  seed={130 + index}
                  fill={move.done ? COLORS.ink : 'rgba(255,250,235,0.7)'}
                >
                  {move.done ? (
                    <CheckMark size={20} color={COLORS.paper} />
                  ) : (
                    <Text style={styles.indexText}>{move.id}</Text>
                  )}
                </SketchCircle>

                <View style={styles.flex}>
                  <Text
                    style={[
                      styles.title,
                      move.done ? styles.titleDone : undefined,
                    ]}
                  >
                    {move.title}
                  </Text>
                  <View style={styles.metaRow}>
                    <Text style={styles.meta}>{move.sets}</Text>
                    <Text style={styles.meta}>-</Text>
                    <Text style={styles.meta}>{move.joint}</Text>
                    {move.today ? <Text style={styles.todayMeta}>- today</Text> : null}
                  </View>
                </View>

                <View style={styles.stars}>
                  {[1, 2, 3].map(dot => {
                    const filled =
                      dot <=
                      ({ easy: 1, med: 2, hard: 3 } as const)[move.difficulty];
                    return (
                      <SketchCircle
                        key={`${move.id}-dot-${dot}`}
                        size={11}
                        seed={500 + move.id + dot}
                        fill={filled ? COLORS.ink : 'transparent'}
                        stroke={COLORS.ink}
                        strokeWidth={1.1}
                      />
                    );
                  })}
                </View>
              </View>
            </SketchBox>
          </View>
        ))}
      </ScrollView>
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
  filterWrap: {
    paddingHorizontal: 22,
    paddingBottom: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  content: {
    paddingHorizontal: 22,
    paddingBottom: 28,
  },
  cardWrap: {
    marginBottom: 10,
  },
  card: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  indexText: {
    fontFamily: FONTS.display,
    fontSize: 18,
    color: COLORS.ink,
  },
  title: {
    fontFamily: FONTS.display,
    fontSize: 22,
    lineHeight: 24,
    color: COLORS.ink,
  },
  titleDone: {
    textDecorationLine: 'line-through',
    textDecorationStyle: 'solid',
    textDecorationColor: COLORS.inkFaint,
  },
  metaRow: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  meta: {
    fontFamily: FONTS.hand,
    fontSize: 13,
    color: COLORS.ink3,
  },
  todayMeta: {
    fontFamily: FONTS.hand,
    fontSize: 13,
    color: COLORS.accentDeep,
  },
  stars: {
    flexDirection: 'row',
    gap: 2,
  },
});
