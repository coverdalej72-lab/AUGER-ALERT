import { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { Icon } from "@/src/components/Icon";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export function fmtMins(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h > 0 && mm > 0) return `${h}h ${mm}m`;
  if (h > 0) return `${h}h`;
  return `${mm}m`;
}

export function Card({ children, style, testID }: { children: ReactNode; style?: any; testID?: string }) {
  const styles = useStyles();
  return (
    <View style={[styles.card, style]} testID={testID}>
      {children}
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

type Tone = "neutral" | "success" | "warning" | "error" | "brand";

export function Pill({ label, tone = "neutral", icon, testID }: { label: string; tone?: Tone; icon?: string; testID?: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const map: Record<Tone, { bg: string; fg: string }> = {
    neutral: { bg: colors.surfaceTertiary, fg: colors.onSurfaceTertiary },
    success: { bg: colors.brandTertiary, fg: colors.success },
    warning: { bg: colors.surfaceTertiary, fg: colors.warning },
    error: { bg: colors.surfaceTertiary, fg: colors.error },
    brand: { bg: colors.brandTertiary, fg: colors.brandPrimary },
  };
  const c = map[tone];
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }]} testID={testID}>
      {icon ? <Icon name={icon} size={13} color={c.fg} /> : null}
      <Text style={[styles.pillText, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

export function Stepper({
  label,
  value,
  onChange,
  step = 30,
  min = 0,
  max = 1440,
  format = fmtMins,
  testID,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  format?: (v: number) => string;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const dec = () => onChange(Math.max(min, value - step));
  const inc = () => onChange(Math.min(max, value + step));
  return (
    <View style={styles.stepperRow} testID={testID}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperControls}>
        <Pressable onPress={dec} style={styles.stepBtn} testID={`${testID}-dec`} hitSlop={6}>
          <Icon name="minus" size={20} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.stepValue} testID={`${testID}-value`}>{format(value)}</Text>
        <Pressable onPress={inc} style={styles.stepBtn} testID={`${testID}-inc`} hitSlop={6}>
          <Icon name="plus" size={20} color={colors.onSurface} />
        </Pressable>
      </View>
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  icon,
  tone = "brand",
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  icon?: string;
  tone?: "brand" | "success" | "danger" | "ghost";
  disabled?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const map = {
    brand: { bg: colors.brandPrimary, fg: colors.onBrandPrimary },
    success: { bg: colors.success, fg: colors.onSuccess },
    danger: { bg: colors.surfaceTertiary, fg: colors.error },
    ghost: { bg: colors.surfaceTertiary, fg: colors.onSurface },
  }[tone];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      style={({ pressed }) => [
        styles.primaryBtn,
        { backgroundColor: map.bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      {icon ? <Icon name={icon} size={18} color={map.fg} /> : null}
      <Text style={[styles.primaryBtnText, { color: map.fg }]}>{label}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  sectionTitle: {
    fontFamily: fonts.textBold,
    color: colors.muted,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: spacing.md,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    alignSelf: "flex-start",
  },
  pillText: {
    fontFamily: fonts.textSemiBold,
    fontSize: 12,
  },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
  },
  stepperLabel: {
    fontFamily: fonts.textMedium,
    color: colors.onSurfaceSecondary,
    fontSize: 15,
    flex: 1,
  },
  stepperControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  stepValue: {
    fontFamily: fonts.displayBold,
    color: colors.onSurface,
    fontSize: 22,
    minWidth: 84,
    textAlign: "center",
  },
  primaryBtn: {
    height: 52,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  primaryBtnText: {
    fontFamily: fonts.textSemiBold,
    fontSize: 16,
  },
}));
