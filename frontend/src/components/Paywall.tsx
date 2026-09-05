import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

import { fetchPlan, startCheckout } from "@/src/api";
import type { BillingPlan } from "@/src/api";
import { Card, PrimaryButton } from "@/src/components/ui";
import { Icon } from "@/src/components/Icon";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(amount);
  } catch {
    return `${currency.toUpperCase()} ${amount}`;
  }
}

export function Paywall({
  savedEmail,
  onSetEmail,
}: {
  savedEmail: string;
  onSetEmail: (email: string) => Promise<void>;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState(savedEmail);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (savedEmail) setEmail(savedEmail);
  }, [savedEmail]);

  const { data: plan } = useQuery<BillingPlan>({ queryKey: ["billing", "plan"], queryFn: fetchPlan });

  const valid = /\S+@\S+\.\S+/.test(email.trim());

  const buy = async () => {
    if (!valid) {
      setMsg("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await onSetEmail(email);
      const { url } = await startCheckout(email.trim().toLowerCase());
      if (typeof window !== "undefined") window.location.assign(url);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not start checkout.");
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!valid) {
      setMsg("Enter the email you paid with.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await onSetEmail(email);
      setMsg("Checking… if you've paid with this email, access unlocks in a moment.");
    } finally {
      setBusy(false);
    }
  };

  const features = [
    "Upload catch sheets & auto-compute every withdrawal time",
    "Pair unlimited manager phones — pick who's on catch each night",
    "Locked-screen phone alarms with escalation",
    "Run delays for late crews",
  ];

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.xl }]}>
      <View style={styles.wrap}>
        <View style={styles.badge}>
          <Icon name="lock-outline" size={28} color={colors.brandPrimary} />
        </View>
        <Text style={styles.h1}>Unlock the Control Centre</Text>
        <Text style={styles.sub}>
          {plan
            ? `${money(plan.amount, plan.currency)} — one payment, unlocks everything for a full year.`
            : "One payment unlocks everything for a full year."}
        </Text>

        <Card style={{ marginTop: spacing.lg, gap: spacing.sm }}>
          {features.map((f) => (
            <View key={f} style={styles.featureRow}>
              <Icon name="check-circle" size={18} color={colors.success} />
              <Text style={styles.featureText}>{f}</Text>
            </View>
          ))}
        </Card>

        <Text style={styles.label}>Your email</Text>
        <TextInput
          value={email}
          onChangeText={(t) => {
            setEmail(t);
            setMsg(null);
          }}
          placeholder="you@farm.com"
          placeholderTextColor={colors.muted}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          testID="billing-email"
        />
        <Text style={styles.fine}>
          We use your email only to remember your access on this browser. No password.
        </Text>

        {msg ? <Text style={styles.msg}>{msg}</Text> : null}

        <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
          <PrimaryButton
            label={busy ? "Opening checkout…" : plan ? `Buy season pass — ${money(plan.amount, plan.currency)}` : "Buy season pass"}
            icon="credit-card-outline"
            onPress={buy}
            disabled={busy}
            testID="billing-buy"
          />
          <PrimaryButton
            label="I've already paid — check access"
            icon="refresh"
            tone="ghost"
            onPress={restore}
            disabled={busy}
            testID="billing-restore"
          />
        </View>

        <Text style={styles.secure}>Secure payment · powered by Stripe</Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface, alignItems: "center" },
  wrap: { width: "100%", maxWidth: 460, paddingHorizontal: spacing.lg },
  badge: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  h1: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 30, marginTop: spacing.md },
  sub: { fontFamily: fonts.text, color: colors.muted, fontSize: 15, marginTop: spacing.xs, lineHeight: 21 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  featureText: { fontFamily: fonts.text, color: colors.onSurfaceSecondary, fontSize: 14, flex: 1 },
  label: { fontFamily: fonts.textSemiBold, color: colors.onSurface, fontSize: 14, marginTop: spacing.lg, marginBottom: spacing.xs },
  input: {
    fontFamily: fonts.text,
    color: colors.onSurface,
    fontSize: 16,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  fine: { fontFamily: fonts.text, color: colors.muted, fontSize: 12, marginTop: spacing.xs, lineHeight: 17 },
  msg: { fontFamily: fonts.textMedium, color: colors.brandSecondary, fontSize: 13, marginTop: spacing.md },
  secure: { fontFamily: fonts.text, color: colors.muted, fontSize: 12, textAlign: "center", marginTop: spacing.lg },
}));
