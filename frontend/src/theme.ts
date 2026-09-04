// Design tokens for the Farm Feed Withdrawal Timer.
// Dark-first utility palette (see /app/design_guidelines.json). Dark-only app:
// the single `light` scheme below carries the dark values so the UI stays
// high-contrast regardless of the device setting.

import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const dark = {
  surface: "#090A0C",
  onSurface: "#F3F4F6",
  surfaceSecondary: "#14161A",
  onSurfaceSecondary: "#E5E7EB",
  surfaceTertiary: "#1F2228",
  onSurfaceTertiary: "#D1D5DB",
  surfaceInverse: "#F9FAFB",
  onSurfaceInverse: "#090A0C",
  muted: "#9CA3AF",

  brand: "#FF5722",
  onBrand: "#FFFFFF",
  brandPrimary: "#FF5722",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#FF8A65",
  onBrandSecondary: "#000000",
  brandTertiary: "#4A1806",
  onBrandTertiary: "#FFCCBC",

  success: "#10B981",
  onSuccess: "#FFFFFF",
  warning: "#F59E0B",
  onWarning: "#000000",
  error: "#EF4444",
  onError: "#FFFFFF",
  info: "#38BDF8",
  onInfo: "#000000",

  border: "#272A30",
  borderStrong: "#3F444E",
  divider: "#1A1C20",
};

export type ThemeColors = typeof dark;

export const defaultScheme = "light" satisfies ColorScheme;

// Both keys map to the same dark palette (dark-only app).
export const themes: { light: ThemeColors; dark?: ThemeColors } = { light: dark, dark };

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
} as const;

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  pill: 999,
} as const;

// Font family keys must match the names loaded via useFonts() in _layout.tsx.
export const fonts = {
  display: "BarlowCondensed-SemiBold",
  displayMedium: "BarlowCondensed-Medium",
  displayBold: "BarlowCondensed-Bold",
  text: "IBMPlexSans-Regular",
  textMedium: "IBMPlexSans-Medium",
  textSemiBold: "IBMPlexSans-SemiBold",
  textBold: "IBMPlexSans-Bold",
} as const;

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme);
}

// Force the app dark regardless of device setting.
setColorScheme?.("dark");

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = system && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}
