import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, qk, type Schedule, type Settings, type Whoami } from "@/src/api";
import { Card, Pill, PrimaryButton, SectionTitle, Stepper } from "@/src/components/ui";
import { FarmManager } from "@/src/components/FarmManager";
import { PushOptIn } from "@/src/components/PushOptIn";
import { Icon } from "@/src/components/Icon";
import { getDeviceId, getDeviceName } from "@/src/utils/device";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";


export default function SettingsScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [deviceId, setDeviceId] = useState("");
  useEffect(() => {
    getDeviceId().then(setDeviceId);
  }, []);
  const { data: whoami } = useQuery<Whoami>({
    queryKey: [...qk.whoami, deviceId],
    queryFn: () => api.get(`/pairing/whoami${deviceId ? `?device_id=${deviceId}` : ""}`),
    enabled: !!deviceId,
    refetchInterval: 8000,
  });
  const { data: settings } = useQuery<Settings>({
    queryKey: qk.settings,
    queryFn: () => api.get("/settings"),
  });
  const { data: latest } = useQuery<{ schedule: Schedule | null }>({
    queryKey: qk.schedule,
    queryFn: () => api.get("/schedule/latest"),
  });
  const availableFarms = latest?.schedule?.farms ?? [];

  const [code, setCode] = useState("");
  const [pairError, setPairError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [local, setLocal] = useState<Settings | null>(null);
  useEffect(() => {
    if (settings && !local) setLocal(settings);
  }, [settings, local]);

  const claim = useMutation({
    mutationFn: async (theCode: string) => {
      const device_id = await getDeviceId();
      const device_name = await getDeviceName();
      return api.post("/pairing/claim", { code: theCode, device_id, device_name });
    },
    onSuccess: () => {
      setPairError(null);
      setCode("");
      qc.invalidateQueries({ queryKey: qk.whoami });
    },
    onError: (e: Error) => setPairError(e.message),
  });

  const saveSettings = useMutation({
    mutationFn: (s: Settings) => api.put("/settings", s),
    onSuccess: () => {
      setSaved(true);
      qc.invalidateQueries({ queryKey: qk.settings });
      qc.invalidateQueries({ queryKey: qk.schedule });
      qc.invalidateQueries({ queryKey: qk.alarms });
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const set = (patch: Partial<Settings>) => {
    setLocal((prev) => (prev ? { ...prev, ...patch } : prev));
    setSaved(false);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.h1}>Settings</Text>
        <Text style={styles.h2}>Pairing, offsets &amp; escalation</Text>
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"], gap: spacing.lg }}
        bottomOffset={20}
        keyboardShouldPersistTaps="handled"
      >
        {/* Pairing */}
        <View>
          <SectionTitle>Phone pairing</SectionTitle>
          <Card testID="pairing-card">
            {whoami?.paired ? (
              <View style={{ gap: spacing.md }}>
                <View style={styles.pairedRow}>
                  <View style={styles.pairedIcon}>
                    <Icon name="account-check" size={26} color={colors.success} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pairedTitle} testID="paired-as">Paired as {whoami.name}</Text>
                    <Text style={styles.pairedSub}>
                      {whoami.assigned
                        ? "You're on catch tonight — alarms are ON"
                        : "Not on catch tonight — you won't be alarmed"}
                    </Text>
                  </View>
                  <Pill
                    label={whoami.assigned ? "On" : "Off"}
                    tone={whoami.assigned ? "success" : "neutral"}
                    icon={whoami.assigned ? "bell-ring" : "bell-off"}
                  />
                </View>
                <Text style={styles.pairHint}>Switch to another manager by entering their code:</Text>
                <TextInput
                  value={code}
                  onChangeText={(t) => {
                    setCode(t.replace(/\D/g, "").slice(0, 6));
                    setPairError(null);
                  }}
                  placeholder="000000"
                  placeholderTextColor={colors.muted}
                  keyboardType="number-pad"
                  style={styles.codeInput}
                  maxLength={6}
                  testID="pairing-code-input"
                />
                {pairError ? <Text style={styles.errText} testID="pairing-error">{pairError}</Text> : null}
                <PrimaryButton
                  label={claim.isPending ? "Switching…" : "Switch manager"}
                  icon="account-switch"
                  onPress={() => code.length >= 4 && claim.mutate(code)}
                  disabled={code.length < 4 || claim.isPending}
                  testID="pair-button"
                />
              </View>
            ) : (
              <View style={{ gap: spacing.md }}>
                <Text style={styles.pairHint}>
                  Enter the code the control centre shows for you. You only pair once — it stays
                  paired, and you&apos;ll be alarmed on the nights you&apos;re assigned.
                </Text>
                <TextInput
                  value={code}
                  onChangeText={(t) => {
                    setCode(t.replace(/\D/g, "").slice(0, 6));
                    setPairError(null);
                  }}
                  placeholder="000000"
                  placeholderTextColor={colors.muted}
                  keyboardType="number-pad"
                  style={styles.codeInput}
                  maxLength={6}
                  testID="pairing-code-input"
                />
                {pairError ? <Text style={styles.errText} testID="pairing-error">{pairError}</Text> : null}
                <PrimaryButton
                  label={claim.isPending ? "Pairing…" : "Pair this phone"}
                  icon="cellphone-link"
                  onPress={() => code.length >= 4 && claim.mutate(code)}
                  disabled={code.length < 4 || claim.isPending}
                  testID="pair-button"
                />
              </View>
            )}
          </Card>
        </View>

        {/* Push alarms */}
        <View>
          <SectionTitle>Alarm notifications</SectionTitle>
          <PushOptIn />
        </View>

        {/* My farms */}
        {local ? (
          <View>
            <SectionTitle>My farms (arm alarms)</SectionTitle>
            <Card testID="my-farms-card">
              <FarmManager
                selected={local.my_farms}
                available={availableFarms}
                onChange={(next) => set({ my_farms: next })}
              />
            </Card>
          </View>
        ) : null}

        {/* Offsets */}
        {local ? (
          <View>
            <SectionTitle>Timing offsets (before catch)</SectionTitle>
            <Card testID="offsets-card">
              <Stepper
                label="Cross auger OFF"
                value={local.augers_offset_min}
                onChange={(v) => set({ augers_offset_min: v })}
                step={30}
                min={0}
                testID="augers-offset"
              />
              <View style={styles.divider} />
              <Stepper
                label="Feed lines UP"
                value={local.lines_offset_min}
                onChange={(v) => set({ lines_offset_min: v })}
                step={30}
                min={0}
                testID="lines-offset"
              />
              <View style={styles.divider} />
              <Stepper
                label="Catch heads-up"
                value={local.catch_headsup_min}
                onChange={(v) => set({ catch_headsup_min: v })}
                step={5}
                min={0}
                testID="headsup-offset"
              />
              <Text style={styles.note}>Set catch heads-up to 0m to disable the pre-catch alarm.</Text>
            </Card>
          </View>
        ) : null}

        {/* Escalation */}
        {local ? (
          <View>
            <SectionTitle>Escalation</SectionTitle>
            <Card testID="escalation-card">
              <Stepper
                label="Re-alert every"
                value={local.realert_interval_min}
                onChange={(v) => set({ realert_interval_min: v })}
                step={1}
                min={1}
                max={60}
                format={(v) => `${v} min`}
                testID="realert-interval"
              />
              <View style={styles.divider} />
              <Stepper
                label="Flag critical after"
                value={local.realert_max}
                onChange={(v) => set({ realert_max: v })}
                step={1}
                min={1}
                max={20}
                format={(v) => `${v}×`}
                testID="realert-max"
              />
              <Text style={styles.note}>
                Unacknowledged alarms re-alert on this interval until you tap Done.
              </Text>
            </Card>
          </View>
        ) : null}

        {local ? (
          <PrimaryButton
            label={saveSettings.isPending ? "Saving…" : saved ? "Saved ✓" : "Save settings"}
            icon={saved ? "check" : "content-save"}
            tone={saved ? "success" : "brand"}
            onPress={() => saveSettings.mutate(local)}
            disabled={saveSettings.isPending}
            testID="save-settings-button"
          />
        ) : null}

        <Text style={styles.tz}>Times shown in {settings?.timezone ?? "local"} timezone</Text>
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  h1: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 26 },
  h2: { fontFamily: fonts.text, color: colors.muted, fontSize: 13, marginTop: 2 },

  pairedRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  pairedIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  pairedTitle: { fontFamily: fonts.textSemiBold, color: colors.onSurface, fontSize: 16 },
  pairedSub: { fontFamily: fonts.text, color: colors.muted, fontSize: 13, marginTop: 2 },
  pairHint: { fontFamily: fonts.text, color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 20 },
  qrBlock: { alignItems: "center", gap: spacing.sm },
  qrImg: { width: 180, height: 180, backgroundColor: colors.surfaceInverse, borderRadius: radius.md, padding: spacing.sm },
  qrCaption: { fontFamily: fonts.text, color: colors.muted, fontSize: 12, textAlign: "center", lineHeight: 17 },
  codeInput: {
    fontFamily: fonts.displayBold,
    color: colors.onSurface,
    fontSize: 40,
    letterSpacing: 12,
    textAlign: "center",
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingVertical: spacing.md,
  },
  errText: { fontFamily: fonts.textMedium, color: colors.error, fontSize: 14, textAlign: "center" },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.xs },
  note: { fontFamily: fonts.text, color: colors.muted, fontSize: 12, marginTop: spacing.sm, lineHeight: 17 },
  tz: { fontFamily: fonts.text, color: colors.muted, fontSize: 12, textAlign: "center" },
}));
