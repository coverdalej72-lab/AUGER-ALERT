import { useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  cancelAnimation,
} from "react-native-reanimated";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";

import { api, qk, type Alarm } from "@/src/api";
import { KIND } from "@/src/format";
import { startAlarm, stopAlarm } from "@/src/utils/sound";
import { getDeviceId } from "@/src/utils/device";
import { Icon } from "@/src/components/Icon";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

async function fireLocalNotification(alarm: Alarm) {
  if (Platform.OS === "web") return;
  try {
    const Notifications = await import("expo-notifications");
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${KIND[alarm.kind].action} — Shed ${alarm.shed}`,
        body: "NOW — tap Done when complete",
        sound: true,
      },
      trigger: null,
    });
  } catch {
    // notifications unavailable (e.g. Expo Go limits) — overlay still shows
  }
}

type ActiveResponse = { alarms: Alarm[]; realert_interval_min: number; realert_max: number };

export function AlarmOverlay() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [deviceId, setDeviceId] = useState("");
  useEffect(() => {
    getDeviceId().then(setDeviceId);
  }, []);

  const { data } = useQuery<ActiveResponse>({
    queryKey: [...qk.activeAlarms, deviceId],
    queryFn: () => api.get(`/alarms/active${deviceId ? `?device_id=${deviceId}` : ""}`),
    refetchInterval: 5000,
  });

  const alarms = data?.alarms ?? [];
  const active = alarms[0];
  const realertMin = data?.realert_interval_min ?? 10;
  const realertMax = data?.realert_max ?? 3;

  const ack = useMutation({
    mutationFn: (id: string) => api.post(`/alarms/${id}/ack`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.activeAlarms });
      qc.invalidateQueries({ queryKey: qk.alarms });
      qc.invalidateQueries({ queryKey: qk.schedule });
      qc.invalidateQueries({ queryKey: qk.log });
    },
  });

  const escalate = useMutation({
    mutationFn: (id: string) => api.post(`/alarms/${id}/escalate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.activeAlarms }),
  });

  // Pulsing ring animation
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (active) {
      pulse.value = withRepeat(
        withTiming(1, { duration: 900, easing: Easing.out(Easing.ease) }),
        -1,
        true,
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = 0;
    }
    return () => cancelAnimation(pulse);
  }, [active, pulse]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.18 }],
    opacity: 0.55 - pulse.value * 0.4,
  }));

  // Loud continuous siren while an alarm is showing; re-alert (escalation
  // count) ticks on the configured interval. Sound stops the moment the alarm
  // is cleared (DONE tapped) or the overlay unmounts.
  const activeId = active?.id;
  const escalateRef = useRef(escalate);
  escalateRef.current = escalate;
  useEffect(() => {
    if (!activeId) {
      stopAlarm();
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    startAlarm();
    fireLocalNotification(active!);

    const heavy = setInterval(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }, 4000);

    const interval = setInterval(
      () => {
        fireLocalNotification(active!);
        escalateRef.current.mutate(activeId);
      },
      Math.max(1, realertMin) * 60 * 1000,
    );
    return () => {
      clearInterval(heavy);
      clearInterval(interval);
      stopAlarm();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, realertMin]);

  if (!active) return null;

  const meta = KIND[active.kind];
  const escalated = active.alert_count >= realertMax && active.alert_count > 0;
  const btnColor = escalated ? colors.brandPrimary : colors.success;
  const btnText = escalated ? colors.onBrandPrimary : colors.onSuccess;

  return (
    <Modal visible transparent={false} animationType="fade" statusBarTranslucent testID="alarm-overlay">
      <View style={[styles.root, { paddingTop: insets.top + spacing.xl }]}>
        <View style={styles.topBadge} testID="alarm-badge">
          <Icon name={escalated ? "alert-octagon" : "bell-ring"} size={16} color={escalated ? colors.error : colors.brandPrimary} />
          <Text style={[styles.badgeText, { color: escalated ? colors.error : colors.brandPrimary }]}>
            {escalated ? `MISSED · re-alerted ${active.alert_count}×` : "ALARM"}
          </Text>
        </View>

        <View style={styles.center}>
          <View style={styles.iconWrap}>
            <Animated.View style={[styles.ring, ringStyle]} />
            <View style={styles.iconCircle}>
              <Icon name={meta.icon} size={56} color={colors.brandPrimary} />
            </View>
          </View>

          <Text style={styles.shed} testID="alarm-shed">
            {active.farm ? active.farm.toUpperCase() + " · " : ""}SHED {active.shed}
          </Text>
          <Text style={styles.action} testID="alarm-action">{meta.action}</Text>
          <Text style={styles.now}>NOW</Text>
          <Text style={styles.due}>Scheduled {active.fire_at_local.slice(11, 16)}</Text>

          {alarms.length > 1 ? (
            <View style={styles.moreChip}>
              <Text style={styles.moreText}>+{alarms.length - 1} more waiting</Text>
            </View>
          ) : null}
        </View>

        <Pressable
          testID="alarm-done-button"
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
            ack.mutate(active.id);
          }}
          disabled={ack.isPending}
          style={({ pressed }) => [
            styles.doneBtn,
            { backgroundColor: btnColor, marginBottom: insets.bottom + spacing.xl },
            pressed && { opacity: 0.85 },
          ]}
        >
          <Icon name="check-bold" size={30} color={btnText} />
          <Text style={[styles.doneText, { color: btnText }]}>
            {ack.isPending ? "SAVING…" : "DONE"}
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.xl,
  },
  topBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceTertiary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  badgeText: {
    fontFamily: fonts.textBold,
    fontSize: 13,
    letterSpacing: 2,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  iconWrap: {
    width: 180,
    height: 180,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  ring: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: colors.brandPrimary,
  },
  iconCircle: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.brandPrimary,
  },
  shed: {
    fontFamily: fonts.displayMedium,
    color: colors.muted,
    fontSize: 30,
    letterSpacing: 4,
  },
  action: {
    fontFamily: fonts.displayBold,
    color: colors.onSurface,
    fontSize: 52,
    lineHeight: 54,
    textAlign: "center",
    textTransform: "uppercase",
  },
  now: {
    fontFamily: fonts.displayBold,
    color: colors.brandPrimary,
    fontSize: 72,
    lineHeight: 76,
    letterSpacing: 2,
  },
  due: {
    fontFamily: fonts.text,
    color: colors.muted,
    fontSize: 15,
  },
  moreChip: {
    marginTop: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  moreText: {
    fontFamily: fonts.textMedium,
    color: colors.onSurfaceSecondary,
    fontSize: 14,
  },
  doneBtn: {
    height: 96,
    borderRadius: radius.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  doneText: {
    fontFamily: fonts.displayBold,
    fontSize: 40,
    letterSpacing: 4,
  },
}));
