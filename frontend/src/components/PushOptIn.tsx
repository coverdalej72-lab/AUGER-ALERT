import { useCallback, useEffect, useState } from "react";
import { Linking, Text, View } from "react-native";

import { Card, Pill, PrimaryButton } from "@/src/components/ui";
import { Icon } from "@/src/components/Icon";
import { getDeviceId } from "@/src/utils/device";
import {
  disablePush,
  enablePush,
  getPushState,
  isIOSWeb,
  isStandalone,
  pushSupported,
  registerSW,
  sendTestPush,
  type PushState,
} from "@/src/utils/push";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export function PushOptIn() {
  const { colors } = useTheme();
  const styles = useStyles();
  const [state, setState] = useState<PushState | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState(false);

  const refresh = useCallback(async () => {
    await registerSW();
    setState(await getPushState());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // iOS Safari tab: Push API is unavailable until added to the Home Screen.
  const iosNeedsInstall = isIOSWeb() && !isStandalone() && !pushSupported();

  if (state === "loading") return null;
  if (state === "unsupported" && !iosNeedsInstall) return null;

  const onEnable = async () => {
    setBusy(true);
    try {
      const id = await getDeviceId();
      setState(await enablePush(id));
    } finally {
      setBusy(false);
    }
  };

  const onDisable = async () => {
    setBusy(true);
    try {
      const id = await getDeviceId();
      setState(await disablePush(id));
    } finally {
      setBusy(false);
    }
  };

  const onTest = async () => {
    setBusy(true);
    try {
      const id = await getDeviceId();
      await sendTestPush(id);
      setTested(true);
      setTimeout(() => setTested(false), 3000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card testID="push-optin">
      <View style={styles.row}>
        <View style={[styles.iconWrap, { backgroundColor: colors.brandTertiary }]}>
          <Icon
            name={state === "on" ? "bell-ring" : "bell-alert-outline"}
            size={24}
            color={state === "on" ? colors.success : colors.brandPrimary}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Night-time phone alarms</Text>
          <Text style={styles.sub}>
            {state === "on"
              ? "On — this phone will ring even when locked."
              : "Get alerted on this phone even when the screen is locked."}
          </Text>
        </View>
        {state === "on" ? <Pill label="On" tone="success" icon="check" /> : null}
      </View>

      {iosNeedsInstall ? (
        <View style={styles.hintBox}>
          <Text style={styles.hint}>
            On iPhone: tap the Share button in Safari, choose{" "}
            <Text style={styles.hintB}>Add to Home Screen</Text>, then open the app from the new icon
            and enable alarms here.
          </Text>
        </View>
      ) : state === "denied" ? (
        <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
          <Text style={styles.hint}>
            Notifications are blocked in your browser settings. Open settings to allow them.
          </Text>
          <PrimaryButton label="Open settings" icon="cog" tone="ghost" onPress={() => Linking.openSettings()} />
        </View>
      ) : state === "on" ? (
        <View style={styles.actions}>
          <PrimaryButton
            label={tested ? "Sent ✓" : busy ? "Sending…" : "Send test"}
            icon={tested ? "check" : "bell-outline"}
            tone={tested ? "success" : "ghost"}
            onPress={onTest}
            disabled={busy}
            testID="push-test"
          />
          <PrimaryButton label="Turn off" icon="bell-off" tone="ghost" onPress={onDisable} disabled={busy} />
        </View>
      ) : (
        <View style={{ marginTop: spacing.md }}>
          <PrimaryButton
            label={busy ? "Enabling…" : "Enable alarms on this phone"}
            icon="bell-ring"
            onPress={onEnable}
            disabled={busy}
            testID="push-enable"
          />
        </View>
      )}
    </Card>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontFamily: fonts.textSemiBold, color: colors.onSurface, fontSize: 16 },
  sub: { fontFamily: fonts.text, color: colors.muted, fontSize: 13, marginTop: 2, lineHeight: 18 },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  hintBox: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  hint: { fontFamily: fonts.text, color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 19 },
  hintB: { fontFamily: fonts.textSemiBold, color: colors.onSurface },
}));
