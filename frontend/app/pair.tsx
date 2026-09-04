import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import { api, qk } from "@/src/api";
import { getDeviceId, getDeviceName } from "@/src/utils/device";
import { Icon } from "@/src/components/Icon";
import { PrimaryButton } from "@/src/components/ui";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

// Opened by scanning the dashboard QR link: /pair?code=123456
export default function PairScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const qc = useQueryClient();
  const { code } = useLocalSearchParams<{ code?: string }>();
  const [status, setStatus] = useState<"working" | "done" | "error">("working");
  const [message, setMessage] = useState("Linking this phone…");

  useEffect(() => {
    (async () => {
      if (!code) {
        setStatus("error");
        setMessage("No pairing code in the link. Open Settings and enter the code shown on your PC.");
        return;
      }
      try {
        const device_id = await getDeviceId();
        const device_name = await getDeviceName();
        await api.post("/pairing/claim", { code, device_id, device_name });
        qc.invalidateQueries({ queryKey: qk.pairing });
        setStatus("done");
        setMessage("Paired! Opening your schedule…");
        setTimeout(() => router.replace("/(tabs)/home"), 1200);
      } catch (e) {
        setStatus("error");
        setMessage((e as Error).message || "Pairing failed. Try the code in Settings.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const icon = status === "done" ? "check-circle" : status === "error" ? "alert-circle" : "cellphone-link";
  const tint = status === "done" ? colors.success : status === "error" ? colors.error : colors.brandPrimary;

  return (
    <View style={styles.root} testID="pair-screen">
      <View style={[styles.circle, { borderColor: tint }]}>
        <Icon name={icon} size={56} color={tint} />
      </View>
      <Text style={styles.title}>Feed Withdrawal Timer</Text>
      <Text style={styles.msg} testID="pair-status">{message}</Text>
      {status === "error" ? (
        <PrimaryButton label="Go to app" icon="arrow-right" onPress={() => router.replace("/(tabs)/home")} testID="pair-continue" />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.lg },
  circle: {
    width: 120, height: 120, borderRadius: 60, borderWidth: 2,
    backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center",
  },
  title: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 28, textAlign: "center" },
  msg: { fontFamily: fonts.text, color: colors.muted, fontSize: 16, textAlign: "center", lineHeight: 22, maxWidth: 320 },
}));
