import React, { useMemo, useState } from 'react';
import {
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  Line,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { COLORS, FONTS, prettyJoint } from './theme';

const BOX_BASE_STYLE: ViewStyle = {
  position: 'relative',
  overflow: 'visible',
};

function rng(seed: number) {
  let state = seed | 0;
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}

export function roughRectPath(
  width: number,
  height: number,
  seed = 7,
  jitter = 1.4,
): string {
  const random = rng(seed);
  const nudge = () => (random() - 0.5) * jitter * 2;
  const points: Array<[number, number]> = [
    [nudge(), nudge()],
    [width + nudge(), nudge()],
    [width + nudge(), height + nudge()],
    [nudge(), height + nudge()],
  ];
  const mid = (a: [number, number], b: [number, number]) =>
    [((a[0] + b[0]) / 2) + nudge() * 1.5, ((a[1] + b[1]) / 2) + nudge() * 1.5] as const;

  let path = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < 4; i += 1) {
    const next = points[(i + 1) % 4];
    const [mx, my] = mid(points[i], next);
    path += ` Q ${mx} ${my}, ${next[0]} ${next[1]}`;
  }
  return `${path} Z`;
}

function roughCirclePath(size: number, seed = 4): string {
  const random = rng(seed);
  const jitter = () => (random() - 0.5) * 1.2;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 2;
  const k = 0.5522847498 * radius;

  return `
    M ${cx + jitter()} ${cy - radius + jitter()}
    C ${cx + k + jitter()} ${cy - radius + jitter()},
      ${cx + radius + jitter()} ${cy - k + jitter()},
      ${cx + radius + jitter()} ${cy + jitter()}
    C ${cx + radius + jitter()} ${cy + k + jitter()},
      ${cx + k + jitter()} ${cy + radius + jitter()},
      ${cx + jitter()} ${cy + radius + jitter()}
    C ${cx - k + jitter()} ${cy + radius + jitter()},
      ${cx - radius + jitter()} ${cy + k + jitter()},
      ${cx - radius + jitter()} ${cy + jitter()}
    C ${cx - radius + jitter()} ${cy - k + jitter()},
      ${cx - k + jitter()} ${cy - radius + jitter()},
      ${cx + jitter()} ${cy - radius + jitter()} Z
  `;
}

export function PaperBackground({
  style,
  includeDoodles = false,
}: {
  style?: StyleProp<ViewStyle>;
  includeDoodles?: boolean;
}) {
  return (
    <View
      pointerEvents="none"
      style={[{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }, style]}
    >
      <Svg width="100%" height="100%" viewBox="0 0 390 780" preserveAspectRatio="none">
        <Defs>
          <RadialGradient id="paperGlow" cx="22%" cy="8%" rx="50%" ry="38%">
            <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.4} />
            <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="paperWarm" cx="84%" cy="92%" rx="58%" ry="48%">
            <Stop offset="0%" stopColor="#C4A25E" stopOpacity={0.12} />
            <Stop offset="100%" stopColor="#C4A25E" stopOpacity={0} />
          </RadialGradient>
        </Defs>

        <Rect width="390" height="780" fill={COLORS.paper} />
        <Rect width="390" height="780" fill="url(#paperGlow)" />
        <Rect width="390" height="780" fill="url(#paperWarm)" />

        <G opacity={0.08}>
          {Array.from({ length: 36 }).map((_, index) => (
            <Line
              key={`h-${index}`}
              x1="0"
              y1={index * 24}
              x2="390"
              y2={index * 24}
              stroke="#8E6F3C"
              strokeWidth="0.6"
            />
          ))}
          {Array.from({ length: 18 }).map((_, index) => (
            <Line
              key={`v-${index}`}
              x1={index * 24}
              y1="0"
              x2={index * 24}
              y2="780"
              stroke="#8E6F3C"
              strokeWidth="0.5"
            />
          ))}
        </G>

        <G opacity={0.16}>
          <Circle cx="44" cy="88" r="1.3" fill="#745224" />
          <Circle cx="110" cy="220" r="1.2" fill="#745224" />
          <Circle cx="260" cy="142" r="1.5" fill="#745224" />
          <Circle cx="308" cy="504" r="1.3" fill="#745224" />
          <Circle cx="158" cy="632" r="1.1" fill="#745224" />
          <Circle cx="76" cy="710" r="1.4" fill="#745224" />
        </G>

        {includeDoodles && (
          <G opacity={0.26}>
            <Path
              d="M -10 132 Q 90 126, 192 136 T 410 132"
              stroke={COLORS.accent}
              strokeWidth="1"
              fill="none"
            />
            <Path
              d="M -10 148 Q 98 143, 210 150 T 410 148"
              stroke={COLORS.accent}
              strokeWidth="1"
              opacity="0.7"
              fill="none"
            />
            <Path
              d="M 18 80 L 18 720"
              stroke={COLORS.accent}
              strokeWidth="1"
              strokeDasharray="2 6"
              fill="none"
            />
            <G transform="translate(338 72)">
              <Circle
                cx="0"
                cy="0"
                r="8"
                stroke={COLORS.warmDeep}
                strokeWidth="1.2"
                fill={COLORS.warmSoft}
              />
              {Array.from({ length: 8 }).map((_, index) => {
                const angle = (index / 8) * Math.PI * 2;
                const x1 = Math.cos(angle) * 12;
                const y1 = Math.sin(angle) * 12;
                const x2 = Math.cos(angle) * 17;
                const y2 = Math.sin(angle) * 17;
                return (
                  <Line
                    key={`sun-${index}`}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={COLORS.warmDeep}
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
                );
              })}
            </G>
            <G transform="translate(340 700)">
              <Path
                d="M 0 20 Q -8 5, -4 -10"
                stroke={COLORS.greenDeep}
                strokeWidth="1.4"
                fill="none"
                strokeLinecap="round"
              />
              <Path
                d="M -4 -10 Q -10 -12, -12 -6"
                stroke={COLORS.greenDeep}
                strokeWidth="1.4"
                fill="none"
                strokeLinecap="round"
              />
              <Path
                d="M -4 -10 Q 2 -14, 6 -8"
                stroke={COLORS.greenDeep}
                strokeWidth="1.4"
                fill="none"
                strokeLinecap="round"
              />
            </G>
          </G>
        )}
      </Svg>
    </View>
  );
}

export function SketchBox({
  children,
  style,
  seed = 4,
  fill = 'rgba(255, 250, 235, 0.45)',
  stroke = COLORS.ink,
  strokeWidth = 1.6,
  double = false,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  seed?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  double?: boolean;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width !== size.width || height !== size.height) {
      setSize({ width, height });
    }
  };

  return (
    <View onLayout={onLayout} style={[BOX_BASE_STYLE, style]}>
      {size.width > 0 && size.height > 0 ? (
        <Svg
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          viewBox={`0 0 ${size.width} ${size.height}`}
        >
          <Path
            d={roughRectPath(size.width - 2, size.height - 2, seed, 1.6)}
            transform="translate(1 1)"
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {double ? (
            <Path
              d={roughRectPath(size.width - 4, size.height - 4, seed + 13, 1)}
              transform="translate(2 2)"
              fill="none"
              stroke={stroke}
              strokeWidth={strokeWidth * 0.65}
              opacity={0.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null}
        </Svg>
      ) : null}
      <View style={styles.relative}>{children}</View>
    </View>
  );
}

export function SketchCircle({
  size = 36,
  seed = 3,
  stroke = COLORS.ink,
  strokeWidth = 1.6,
  fill = 'transparent',
  children,
  style,
}: {
  size?: number;
  seed?: number;
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const path = useMemo(() => roughCirclePath(size, seed), [seed, size]);

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Svg
        pointerEvents="none"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={StyleSheet.absoluteFill}
      >
        <Path
          d={path}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
      <View style={styles.relative}>{children}</View>
    </View>
  );
}

export function CheckMark({
  size = 18,
  color = COLORS.ink,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M3 13 Q 5 14, 9 19 Q 14 10, 22 4"
        fill="none"
        stroke={color}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function Squiggle({
  width = 80,
  color = COLORS.ink,
  style,
}: {
  width?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={style}>
      <Svg width={width} height={6} viewBox={`0 0 ${width} 6`}>
        <Path
          d={`M 1 4 Q ${width * 0.15} 1, ${width * 0.3} 4 T ${width * 0.6} 4 T ${width * 0.9} 4 T ${width - 1} 3.5`}
          stroke={color}
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}

export function InkButton({
  label,
  onPress,
  style,
  textStyle,
  disabled,
  fill = COLORS.ink,
  textColor = COLORS.paper,
}: {
  label: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  disabled?: boolean;
  fill?: string;
  textColor?: string;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.inkButton,
        {
          backgroundColor: fill,
          opacity: disabled ? 0.45 : pressed ? 0.92 : 1,
          transform: [{ translateX: pressed ? 1 : 0 }, { translateY: pressed ? 1 : 0 }],
        },
        style,
      ]}
    >
      <Text style={[styles.inkButtonText, { color: textColor }, textStyle]}>{label}</Text>
    </Pressable>
  );
}

export function TagPill({
  label,
  active,
  accent,
  onPress,
  style,
}: {
  label: string;
  active?: boolean;
  accent?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const content = (
    <View
      style={[
        styles.tagPill,
        active && styles.tagPillActive,
        accent && !active && styles.tagPillAccent,
        style,
      ]}
    >
      <Text
        style={[
          styles.tagPillText,
          active && styles.tagPillTextActive,
          accent && !active && { color: COLORS.accentDeep },
        ]}
      >
        {label}
      </Text>
    </View>
  );

  if (!onPress) return content;
  return <Pressable onPress={onPress}>{content}</Pressable>;
}

export function ScreenHeader({
  title,
  subtitle,
  onBack,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
}) {
  return (
    <View style={styles.screenHeader}>
      <View style={styles.headerRow}>
        {onBack ? (
          <Pressable onPress={onBack} style={styles.backButton}>
            <Svg width={22} height={22} viewBox="0 0 24 24">
              <Path
                d="M16 4 Q 7 11, 4 12 Q 7 13, 16 20"
                stroke={COLORS.ink}
                strokeWidth="1.8"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </Pressable>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>
      <Text style={styles.screenTitle}>{title}</Text>
      <Squiggle width={120} />
      {subtitle ? <Text style={styles.screenSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function OnboardingShell({
  step,
  total,
  title,
  onBack,
  children,
}: {
  step: number;
  total: number;
  title: string;
  onBack?: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.flex}>
      <PaperBackground />
      <View style={styles.onboardingTopBar}>
        <Pressable onPress={onBack} hitSlop={8} style={styles.backButton}>
          <Svg width={22} height={22} viewBox="0 0 24 24">
            <Path
              d="M16 4 Q 7 11, 4 12 Q 7 13, 16 20"
              stroke={COLORS.ink}
              strokeWidth="1.8"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Pressable>
        <View style={styles.progressRow}>
          {Array.from({ length: total }).map((_, index) => (
            <View
              key={`progress-${index}`}
              style={[
                styles.progressBar,
                index < step ? styles.progressBarActive : undefined,
              ]}
            />
          ))}
        </View>
        <Text style={styles.progressCount}>
          {step}/{total}
        </Text>
      </View>
      <ScrollView
        contentContainerStyle={styles.onboardingScrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.screenTitle}>{title}</Text>
        <Squiggle width={140} />
        <View style={styles.onboardingContent}>{children}</View>
      </ScrollView>
    </View>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

export function SketchInput({
  multiline,
  suffix,
  style,
  inputStyle,
  ...props
}: TextInputProps & {
  suffix?: string;
  style?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
}) {
  return (
    <SketchBox
      seed={String(props.placeholder ?? '').length + 17}
      style={[styles.inputBox, multiline && styles.inputBoxMultiline, style]}
      fill="rgba(255, 253, 245, 0.78)"
    >
      <View style={styles.inputRow}>
        <TextInput
          {...props}
          multiline={multiline}
          placeholderTextColor={COLORS.inkFaint}
          style={[
            styles.input,
            multiline && styles.multilineInput,
            inputStyle,
          ]}
        />
        {suffix ? <Text style={styles.inputSuffix}>{suffix}</Text> : null}
      </View>
    </SketchBox>
  );
}

export function BodyMini({
  side,
  small,
}: {
  side: 'left' | 'right' | 'bilateral';
  small?: boolean;
}) {
  const width = small ? 42 : 70;
  const height = small ? 56 : 96;
  const leftFill = side === 'left' || side === 'bilateral' ? COLORS.ink : 'transparent';
  const rightFill =
    side === 'right' || side === 'bilateral' ? COLORS.ink : 'transparent';

  return (
    <Svg width={width} height={height} viewBox="0 0 60 80">
      <Circle
        cx="30"
        cy="12"
        r="8"
        stroke={COLORS.ink}
        strokeWidth="1.4"
        fill="rgba(255,250,235,0.5)"
      />
      <Path
        d="M 22 22 Q 18 40, 22 58 L 38 58 Q 42 40, 38 22 Z"
        stroke={COLORS.ink}
        strokeWidth="1.4"
        fill="rgba(255,250,235,0.5)"
        strokeLinejoin="round"
      />
      <Path d="M 28 58 L 26 76" stroke={COLORS.ink} strokeWidth="1.4" strokeLinecap="round" />
      <Path d="M 32 58 L 34 76" stroke={COLORS.ink} strokeWidth="1.4" strokeLinecap="round" />
      <Ellipse cx="22" cy="40" rx="4" ry="14" fill={leftFill} opacity="0.85" />
      <Ellipse cx="38" cy="40" rx="4" ry="14" fill={rightFill} opacity="0.85" />
    </Svg>
  );
}

const BODY_JOINTS = [
  { id: 'cervical_flexion', cx: 80, cy: 40, lr: 'C' },
  { id: 'shoulder_flexion', cx: 56, cy: 54, lr: 'L' },
  { id: 'shoulder_flexion_r', cx: 104, cy: 54, lr: 'R' },
  { id: 'thoracic_flexion', cx: 80, cy: 78, lr: 'C' },
  { id: 'elbow_flexion', cx: 38, cy: 96, lr: 'L' },
  { id: 'elbow_flexion_r', cx: 122, cy: 96, lr: 'R' },
  { id: 'lumbar_flexion', cx: 80, cy: 118, lr: 'C' },
  { id: 'wrist_flexion', cx: 36, cy: 130, lr: 'L' },
  { id: 'wrist_flexion_r', cx: 124, cy: 130, lr: 'R' },
  { id: 'hip_flexion', cx: 64, cy: 148, lr: 'L' },
  { id: 'hip_flexion_r', cx: 96, cy: 148, lr: 'R' },
  { id: 'knee_flexion', cx: 60, cy: 200, lr: 'L' },
  { id: 'knee_flexion_r', cx: 100, cy: 200, lr: 'R' },
  { id: 'ankle_dorsiflexion', cx: 58, cy: 252, lr: 'L' },
  { id: 'ankle_dorsiflexion_r', cx: 102, cy: 252, lr: 'R' },
] as const;

export function BodyDiagram({
  selected,
  side = 'unknown',
  onToggle,
}: {
  selected: string[];
  side?: 'left' | 'right' | 'bilateral' | 'unknown';
  onToggle: (jointId: string) => void;
}) {
  return (
    <Svg width="100%" height={300} viewBox="0 0 160 280">
      <Ellipse
        cx="80"
        cy="22"
        rx="14"
        ry="16"
        fill="rgba(255,250,235,0.3)"
        stroke={COLORS.ink}
        strokeWidth="1.4"
      />
      <Path
        d="M 74 36 L 74 44 M 86 36 L 86 44"
        stroke={COLORS.ink}
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d="M 60 46 Q 56 80, 58 110 Q 56 128, 62 142 L 98 142 Q 104 128, 102 110 Q 104 80, 100 46 Q 92 42, 80 42 Q 68 42, 60 46 Z"
        fill="rgba(255,250,235,0.3)"
        stroke={COLORS.ink}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <Path
        d="M 60 50 Q 42 70, 38 100 Q 36 116, 40 128"
        fill="none"
        stroke={COLORS.ink}
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <Path
        d="M 100 50 Q 118 70, 122 100 Q 124 116, 120 128"
        fill="none"
        stroke={COLORS.ink}
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <Path
        d="M 64 142 Q 60 180, 58 220 Q 56 244, 56 262"
        fill="none"
        stroke={COLORS.ink}
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <Path
        d="M 78 142 Q 76 180, 76 220 Q 74 244, 70 262"
        fill="none"
        stroke={COLORS.ink}
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <Path
        d="M 82 142 Q 84 180, 84 220 Q 86 244, 90 262"
        fill="none"
        stroke={COLORS.ink}
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <Path
        d="M 96 142 Q 100 180, 102 220 Q 104 244, 104 262"
        fill="none"
        stroke={COLORS.ink}
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <Path
        d="M 50 264 Q 48 270, 56 268 L 64 264"
        stroke={COLORS.ink}
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d="M 110 264 Q 112 270, 104 268 L 96 264"
        stroke={COLORS.ink}
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
      />

      {BODY_JOINTS.map(joint => {
        const normalized = joint.id.replace('_r', '');
        const isSelected =
          selected.includes(joint.id) || selected.includes(normalized);
        const inactive =
          (side === 'left' && joint.lr === 'R') ||
          (side === 'right' && joint.lr === 'L');

        return (
          <G
            key={joint.id}
            onPress={() => !inactive && onToggle(joint.id)}
            opacity={inactive ? 0.25 : 1}
          >
            <Circle
              cx={joint.cx}
              cy={joint.cy}
              r="9"
              fill={isSelected ? COLORS.ink : 'rgba(255,250,235,0.9)'}
              stroke={COLORS.ink}
              strokeWidth="1.4"
            />
            {isSelected ? (
              <Circle cx={joint.cx} cy={joint.cy} r="3" fill={COLORS.paper} />
            ) : null}
          </G>
        );
      })}
    </Svg>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export function Stat({
  label,
  value,
  small,
}: {
  label: string;
  value: React.ReactNode;
  small?: boolean;
}) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, small && styles.statValueSmall]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function PainSlider({
  label,
  value,
  onChange,
  seed,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  seed: number;
}) {
  const color =
    value > 6 ? COLORS.bad : value > 3 ? COLORS.warn : COLORS.ink;

  return (
    <View style={{ marginBottom: 18 }}>
      <View style={styles.painHeader}>
        <Text style={styles.painLabel}>{label}</Text>
        <Text style={[styles.painValue, { color }]}>
          {value}
          <Text style={styles.painScale}>/10</Text>
        </Text>
      </View>
      <SketchBox
        seed={seed}
        style={styles.painBox}
        fill="rgba(255,250,235,0.4)"
      >
        <View style={styles.painScaleRow}>
          {Array.from({ length: 11 }).map((_, index) => {
            const active = index === value;
            const filled = index <= value;
            return (
              <Pressable
                key={`${label}-${index}`}
                onPress={() => onChange(index)}
                style={styles.painTickPressable}
              >
                <View style={styles.painTickColumn}>
                  <View
                    style={[
                      styles.painTick,
                      {
                        backgroundColor: filled ? color : 'transparent',
                        transform: [{ scale: active ? 1.15 : 1 }],
                      },
                    ]}
                  />
                  <Text style={styles.painTickLabel}>{index}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </SketchBox>
    </View>
  );
}

export function MovementsIcon() {
  return (
    <Svg width={44} height={44} viewBox="0 0 44 44">
      <Circle cx="14" cy="14" r="5" stroke={COLORS.ink} strokeWidth="1.6" fill="none" />
      <Path
        d="M 14 19 L 14 30 M 9 22 L 19 22 M 14 30 L 9 38 M 14 30 L 19 38"
        stroke={COLORS.ink}
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d="M 28 18 Q 36 15, 40 22 Q 36 29, 28 26"
        stroke={COLORS.ink}
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d="M 30 32 Q 36 30, 40 36"
        stroke={COLORS.ink}
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function DoctorIcon() {
  return (
    <Svg width={44} height={44} viewBox="0 0 44 44">
      <Rect
        x="6"
        y="8"
        width="32"
        height="30"
        rx="2"
        stroke={COLORS.ink}
        strokeWidth="1.6"
        fill="none"
      />
      <Path
        d="M 22 12 L 22 24 M 16 18 L 28 18"
        stroke={COLORS.accentDeep}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <Path
        d="M 12 30 L 24 30 M 12 34 L 20 34"
        stroke={COLORS.ink}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function ReturnIcon() {
  return (
    <Svg width={44} height={44} viewBox="0 0 44 44">
      <Path
        d="M 8 22 Q 14 8, 28 12 Q 38 18, 32 30 Q 22 38, 12 32"
        stroke={COLORS.ink}
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d="M 12 32 L 7 28 M 12 32 L 14 25"
        stroke={COLORS.ink}
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function TalkIcon() {
  return (
    <Svg width={28} height={28} viewBox="0 0 32 32">
      <Path
        d="M 5 8 Q 5 5, 8 5 L 24 5 Q 27 5, 27 8 L 27 19 Q 27 22, 24 22 L 14 22 L 9 27 L 10 22 L 8 22 Q 5 22, 5 19 Z"
        stroke={COLORS.accentDeep}
        strokeWidth="1.6"
        fill="none"
        strokeLinejoin="round"
      />
      <Circle cx="11" cy="13.5" r="1.4" fill={COLORS.accentDeep} />
      <Circle cx="16" cy="13.5" r="1.4" fill={COLORS.accentDeep} />
      <Circle cx="21" cy="13.5" r="1.4" fill={COLORS.accentDeep} />
    </Svg>
  );
}

export function RecordIcon() {
  return (
    <Svg width={32} height={32} viewBox="0 0 32 32">
      <Path
        d="M 7 4 L 22 4 L 27 9 L 27 28 L 7 28 Z"
        stroke={COLORS.ink}
        strokeWidth="1.5"
        fill="rgba(255,250,235,0.7)"
        strokeLinejoin="round"
      />
      <Path
        d="M 22 4 L 22 9 L 27 9"
        stroke={COLORS.ink}
        strokeWidth="1.5"
        fill="none"
        strokeLinejoin="round"
      />
      <Path
        d="M 11 14 L 23 14 M 11 18 L 23 18 M 11 22 L 19 22"
        stroke={COLORS.ink3}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function prettySelectedJoints(selected: string[]) {
  if (selected.length === 0) return 'none yet';
  return selected.map(prettyJoint).join(', ');
}

const styles = StyleSheet.create({
  relative: {
    zIndex: 1,
  },
  flex: {
    flex: 1,
  },
  inkButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 18,
  },
  inkButtonText: {
    fontFamily: FONTS.handBold,
    fontSize: 17,
    letterSpacing: 0.1,
  },
  tagPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: COLORS.ink,
    backgroundColor: 'rgba(255,250,235,0.62)',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagPillActive: {
    backgroundColor: COLORS.ink,
  },
  tagPillAccent: {
    backgroundColor: COLORS.accentSoft,
    borderColor: COLORS.accentDeep,
  },
  tagPillText: {
    fontFamily: FONTS.hand,
    fontSize: 13,
    color: COLORS.ink,
  },
  tagPillTextActive: {
    color: COLORS.paper,
  },
  screenHeader: {
    paddingTop: 56,
    paddingHorizontal: 22,
    paddingBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  backButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: {
    width: 28,
    height: 28,
  },
  screenTitle: {
    fontFamily: FONTS.display,
    fontSize: 36,
    lineHeight: 40,
    color: COLORS.ink,
    transform: [{ rotate: '-0.6deg' }],
  },
  screenSubtitle: {
    marginTop: 6,
    color: COLORS.ink3,
    fontFamily: FONTS.hand,
    fontSize: 13,
  },
  onboardingTopBar: {
    paddingTop: 56,
    paddingHorizontal: 22,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  progressRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  progressBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(28,38,50,0.18)',
  },
  progressBarActive: {
    backgroundColor: COLORS.ink,
  },
  progressCount: {
    fontFamily: FONTS.hand,
    fontSize: 12,
    color: COLORS.ink3,
  },
  onboardingScrollContent: {
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 28,
  },
  onboardingContent: {
    marginTop: 18,
  },
  fieldLabel: {
    marginBottom: 6,
    fontFamily: FONTS.hand,
    fontSize: 13,
    color: COLORS.ink3,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  inputBox: {
    paddingHorizontal: 4,
    minHeight: 50,
    justifyContent: 'center',
  },
  inputBoxMultiline: {
    minHeight: 92,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: COLORS.ink,
    fontFamily: FONTS.hand,
    fontSize: 17,
  },
  multilineInput: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  inputSuffix: {
    paddingRight: 14,
    paddingLeft: 4,
    color: COLORS.ink3,
    fontFamily: FONTS.hand,
    fontSize: 14,
  },
  sectionLabel: {
    marginTop: 20,
    marginBottom: 8,
    color: COLORS.ink3,
    fontFamily: FONTS.hand,
    fontSize: 12,
    letterSpacing: 1.4,
  },
  stat: {
    alignItems: 'center',
  },
  statValue: {
    fontFamily: FONTS.display,
    fontSize: 24,
    lineHeight: 28,
    color: COLORS.ink,
  },
  statValueSmall: {
    fontSize: 18,
    lineHeight: 22,
  },
  statLabel: {
    fontFamily: FONTS.hand,
    fontSize: 11,
    color: COLORS.ink3,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  painHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 6,
  },
  painLabel: {
    fontFamily: FONTS.display,
    fontSize: 22,
    color: COLORS.ink,
  },
  painValue: {
    fontFamily: FONTS.display,
    fontSize: 28,
    lineHeight: 32,
  },
  painScale: {
    fontFamily: FONTS.hand,
    fontSize: 14,
    color: COLORS.ink3,
  },
  painBox: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  painScaleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 4,
  },
  painTickPressable: {
    flex: 1,
  },
  painTickColumn: {
    alignItems: 'center',
    gap: 4,
  },
  painTick: {
    width: 16,
    height: 22,
    borderWidth: 1.4,
    borderColor: COLORS.ink,
    borderRadius: 3,
  },
  painTickLabel: {
    fontFamily: FONTS.hand,
    fontSize: 10,
    color: COLORS.inkFaint,
  },
});
