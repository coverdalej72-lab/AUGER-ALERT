import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { loginAccount, registerAccount } from "@/src/api";
import { PrimaryButton } from "@/src/components/ui";
import { Icon } from "@/src/components/Icon";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export function AuthScreen({ onAuthed }: { onAuthed: (email: string) => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const em = email.trim().toLowerCase();
    if (!/\S+@\S+\.\S+/.test(em)) {
      setErr("Enter a valid email address.");
      return;
    }
    if (password.length < 6) {
      setErr("Password must be at least 6 characters.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = mode === "login" ? await loginAccount(em, password) : await registerAccount(em, password);
      onAuthed(r.email);
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
          <Icon name="account-lock" size={28} color={colors.brandPrimary} />
        </View>
        <Text style={styles.h1}>{mode === "login" ? "Sign in" : "Create your account"}</Text>
        <Text style={styles.sub}>
          {mode === "login"
            ? "Sign in to your private Control Centre."
            : "Your farm's data stays private to your account."}
        </Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          value={email}
          onChangeText={(t) => { setEmail(t); setErr(null); }}
          placeholder="you@farm.com"
          placeholderTextColor={colors.muted}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          testID="auth-email"
        />
        <Text style={styles.label}>Password</Text>
        <TextInput
          value={password}
          onChangeText={(t) => { setPassword(t); setErr(null); }}
          placeholder="At least 6 characters"
          placeholderTextColor={colors.muted}
          secureTextEntry
          autoCapitalize="none"
          style={styles.input}
          testID="auth-password"
          onSubmitEditing={submit}
        />

        {err ? <Text style={styles.err}>{err}</Text> : null}

        <View style={{ marginTop: spacing.lg }}>
          <PrimaryButton
            label={busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
            icon={mode === "login" ? "login" : "account-plus"}
            onPress={submit}
            disabled={busy}
            testID="auth-submit"
          />
        </View>

        <Text
          style={styles.switch}
          onPress={() => { setMode(mode === "login" ? "register" : "login"); setErr(null); }}
          testID="auth-switch"
        >
          {mode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}
        </Text>
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
  switch: { fontFamily: fonts.textSemiBold, color: colors.brandPrimary, fontSize: 14, textAlign: "center", marginTop: spacing.lg },
}));
