import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { fetchPaymentStatus } from "@/src/api";
import { setBillingEmail } from "@/src/utils/billing";
import { Icon } from "@/src/components/Icon";
import { PrimaryButton } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Phase = "checking" | "paid" | "failed";

export default function BillingReturn() {
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ session_id?: string }>();
  const sessionId = typeof params.session_id === "string" ? params.session_id : undefined;
  const [phase, setPhase] = useState<Phase>("checking");

  useEffect(() => {
    if (!sessionId) {
      setPhase("failed");
      return;
    }
    let stopped = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const r = await fetchPaymentStatus(sessionId);
        if (stopped) return;
        if (r.payment_status === "paid" && r.fulfilled) {
          if (r.email) await setBillingEmail(r.email);
          setPhase("paid");
          setTimeout(() => {
            if (!stopped) router.replace("/dashboard");
          }, 1400);
          return;
        }
        if (r.status === "expired") {
          setPhase("failed");
          return;
        }
      } catch {
        // transient — keep polling
      }
      attempts += 1;
      if (attempts < 30) timer = setTimeout(poll, 2000);
      else setPhase("failed");
    };

    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [sessionId, router]);

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        {phase === "checking" ? (
          <>
            <ActivityIndicator size="large" color={colors.brandPrimary} />
            <Text style={styles.title}>Confirming your payment…</Text>
            <Text style={styles.sub}>This only takes a moment.</Text>
          </>
        ) : phase === "paid" ? (
          <>
            <View style={[styles.badge, { backgroundColor: colors.brandTertiary }]}>
              <Icon name="check-circle" size={40} color={colors.success} />
            </View>
            <Text style={styles.title}>You&apos;re in! 🎉</Text>
            <Text style={styles.sub}>Season pass active for 1 year. Taking you to the control centre…</Text>
          </>
        ) : (
          <>
            <View style={[styles.badge, { backgroundColor: colors.surfaceTertiary }]}>
              <Icon name="alert-circle-outline" size={40} color={colors.error} />
            </View>
            <Text style={styles.title}>Payment not completed</Text>
            <Text style={styles.sub}>No charge was made, or it&apos;s still processing. You can try again.</Text>
            <PrimaryButton label="Back to control centre" icon="arrow-left" onPress={() => router.replace("/dashboard")} />
          </>
        )}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  card: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
  },
  badge: { width: 72, height: 72, borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 24, textAlign: "center" },
  sub: { fontFamily: fonts.text, color: colors.muted, fontSize: 14, textAlign: "center", lineHeight: 20 },
}));
