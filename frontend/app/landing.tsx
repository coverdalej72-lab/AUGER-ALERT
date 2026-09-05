import { Platform, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Redirect, useRouter } from "expo-router";
import { Image } from "expo-image";

import { Icon } from "@/src/components/Icon";
import { PrimaryButton } from "@/src/components/ui";
import { isPhoneWeb } from "@/src/utils/platform";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const DASH = require("../assets/images/shot-dashboard.jpg");
const PHONE = require("../assets/images/shot-phone.jpg");

const STEPS = [
  { icon: "file-upload-outline", title: "Upload the catch sheet", body: "Drop in the processor's .xlsx/.csv on your computer." },
  { icon: "clock-check-outline", title: "It sorts every time", body: "Per shed: catch, cross-auger OFF and feed-lines UP — computed automatically." },
  { icon: "cellphone-message", title: "Your phone gets alarmed", body: "Timed alerts with a big Done button. Miss one and it re-alerts until you tap it." },
];

export default function Landing() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= 900;

  // On a computer, never show the marketing page — go straight to the program.
  if (Platform.OS === "web" && !isPhoneWeb()) return <Redirect href="/dashboard" />;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing["2xl"] }]}
      testID="landing-page"
    >
      {/* Hero */}
      <View style={styles.hero}>
        <View style={styles.logo}>
          <Icon name="timer-alert" size={30} color={colors.brandPrimary} />
        </View>
        <Text style={styles.kicker}>FEED WITHDRAWAL TIMER</Text>
        <Text style={styles.h1}>Never sleep through a cross-auger shut-off again</Text>
        <Text style={styles.sub}>
          Upload the catch sheet on your computer. It works out every auger-off and
          lines-up time, then alarms your phone at the exact minute — with a tap to confirm done.
        </Text>
        <View style={[styles.ctaRow, !wide && { flexDirection: "column" }]}>
          <PrimaryButton label="Open Control Centre" icon="monitor-dashboard" onPress={() => router.push("/dashboard")} testID="cta-control-centre" />
          <PrimaryButton label="Open the phone app" icon="cellphone" tone="ghost" onPress={() => router.push("/(tabs)/home")} testID="cta-phone-app" />
        </View>
        <Text style={styles.noExpo}>Runs in any browser — no Expo, no app store, no install.</Text>
      </View>

      {/* Screenshots */}
      <View style={[styles.shots, !wide && { flexDirection: "column" }]}>
        <View style={styles.dashCard}>
          <Text style={styles.shotLabel}>On your computer</Text>
          <Image source={DASH} style={styles.dashImg} contentFit="cover" testID="shot-dashboard" />
        </View>
        <View style={styles.phoneCard}>
          <Text style={styles.shotLabel}>On your phone</Text>
          <Image source={PHONE} style={styles.phoneImg} contentFit="cover" testID="shot-phone" />
        </View>
      </View>

      {/* How it works */}
      <Text style={styles.sectionH}>How it works</Text>
      <View style={[styles.steps, !wide && { flexDirection: "column" }]}>
        {STEPS.map((s, i) => (
          <View key={s.title} style={styles.step}>
            <View style={styles.stepIcon}>
              <Icon name={s.icon} size={24} color={colors.brandPrimary} />
            </View>
            <Text style={styles.stepNum}>STEP {i + 1}</Text>
            <Text style={styles.stepTitle}>{s.title}</Text>
            <Text style={styles.stepBody}>{s.body}</Text>
          </View>
        ))}
      </View>

      {/* Bottom CTA */}
      <View style={styles.bottomCta}>
        <Text style={styles.bottomTitle}>Ready to run tonight&apos;s pickup?</Text>
        <PrimaryButton label="Open Control Centre" icon="arrow-right" onPress={() => router.push("/dashboard")} testID="cta-bottom" />
      </View>
      <Text style={styles.footer}>Built for growers · one farm, one paired phone</Text>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: spacing.xl, maxWidth: 1120, width: "100%", alignSelf: "center", gap: spacing["2xl"] },

  hero: { alignItems: "center", gap: spacing.md, paddingTop: spacing.lg },
  logo: {
    width: 60, height: 60, borderRadius: radius.lg, backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.brandPrimary,
  },
  kicker: { fontFamily: fonts.textBold, color: colors.brandPrimary, fontSize: 13, letterSpacing: 3 },
  h1: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 44, lineHeight: 46, textAlign: "center", maxWidth: 720 },
  sub: { fontFamily: fonts.text, color: colors.muted, fontSize: 17, lineHeight: 25, textAlign: "center", maxWidth: 620 },
  ctaRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md, alignItems: "stretch" },
  noExpo: { fontFamily: fonts.textMedium, color: colors.onSurfaceTertiary, fontSize: 13, marginTop: spacing.xs },

  shots: { flexDirection: "row", gap: spacing.lg, alignItems: "flex-start" },
  dashCard: {
    flex: 2, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, gap: spacing.sm, minWidth: 280,
  },
  phoneCard: {
    flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, gap: spacing.sm, minWidth: 260, alignItems: "center",
  },
  shotLabel: { fontFamily: fonts.textBold, color: colors.muted, fontSize: 11, letterSpacing: 1.5 },
  dashImg: { width: "100%", aspectRatio: 1.4, borderRadius: radius.md, backgroundColor: colors.surface },
  phoneImg: { width: 220, aspectRatio: 0.62, borderRadius: radius.md, backgroundColor: colors.surface },

  sectionH: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 30, textAlign: "center" },
  steps: { flexDirection: "row", gap: spacing.lg },
  step: {
    flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, padding: spacing.lg, gap: spacing.xs, minWidth: 240,
  },
  stepIcon: {
    width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center", marginBottom: spacing.sm,
  },
  stepNum: { fontFamily: fonts.textBold, color: colors.brandPrimary, fontSize: 12, letterSpacing: 1.5 },
  stepTitle: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 22 },
  stepBody: { fontFamily: fonts.text, color: colors.muted, fontSize: 15, lineHeight: 21 },

  bottomCta: { alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing["2xl"] },
  bottomTitle: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 26, textAlign: "center" },
  footer: { fontFamily: fonts.text, color: colors.muted, fontSize: 13, textAlign: "center" },
}));
