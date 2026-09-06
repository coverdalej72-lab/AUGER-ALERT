import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { confirmPasswordReset } from "@/src/api";
import { Icon } from "@/src/components/Icon";
import { PrimaryButton } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function ResetPassword() {
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = typeof params.token === "string" ? params.token : undefined;

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!token) {
      setErr("This reset link is invalid. Please request a new one.");
      return;
    }
    if (password.length < 6) {
      setErr("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setErr("Those passwords don't match.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await confirmPasswordReset(token, password);
      setDone(true);
      setTimeout(() => router.replace("/dashboard"), 1400);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.xl }]}>
      <View style={styles.wrap}>
        <View style={styles.badge}>
          <Icon name={done ? "check-circle" : "lock-reset"} size={28} color={done ? colors.success : colors.brandPrimary} />
        </View>

        {done ? (
          <>
            <Text style={styles.h1}>Password updated 🎉</Text>
            <Text style={styles.sub}>Taking you to your Control Centre…</Text>
          </>
        ) : !token ? (
          <>
            <Text style={styles.h1}>Link expired</Text>
            <Text style={styles.sub}>This reset link is invalid or has expired. Head back and request a new one.</Text>
            <View style={{ marginTop: spacing.lg }}>
              <PrimaryButton label="Back to sign in" icon="arrow-left" onPress={() => router.replace("/dashboard")} />
            </View>
          </>
        ) : (
          <>
            <Text style={styles.h1}>Choose a new password</Text>
            <Text style={styles.sub}>Pick something you&apos;ll remember — at least 6 characters.</Text>

            <Text style={styles.label}>New password</Text>
            <TextInput
              value={password}
              onChangeText={(t) => { setPassword(t); setErr(null); }}
              placeholder="At least 6 characters"
              placeholderTextColor={colors.muted}
              secureTextEntry
              autoCapitalize="none"
              style={styles.input}
              testID="reset-password"
            />
            <Text style={styles.label}>Confirm password</Text>
            <TextInput
              value={confirm}
              onChangeText={(t) => { setConfirm(t); setErr(null); }}
              placeholder="Type it again"
              placeholderTextColor={colors.muted}
              secureTextEntry
              autoCapitalize="none"
              style={styles.input}
              testID="reset-confirm"
              onSubmitEditing={submit}
            />

            {err ? <Text style={styles.err}>{err}</Text> : null}

            <View style={{ marginTop: spacing.lg }}>
              <PrimaryButton
                label={busy ? "Please wait…" : "Save new password"}
                icon="content-save"
                onPress={submit}
                disabled={busy}
                testID="reset-submit"
              />
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface, alignItems: "center" },
  wrap: { width: "100%", maxWidth: 420, paddingHorizontal: spacing.lg },
  badge: {
    width: 56, height: 56, borderRadius: radius.lg, backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  h1: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 30, marginTop: spacing.md },
  sub: { fontFamily: fonts.text, color: colors.muted, fontSize: 15, marginTop: spacing.xs, lineHeight: 21 },
  label: { fontFamily: fonts.textSemiBold, color: colors.onSurface, fontSize: 14, marginTop: spacing.lg, marginBottom: spacing.xs },
  input: {
    fontFamily: fonts.text, color: colors.onSurface, fontSize: 16,
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.borderStrong, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  err: { fontFamily: fonts.textMedium, color: colors.error, fontSize: 13, marginTop: spacing.md },
}));
