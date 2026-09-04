import { FlatList, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

import { api, qk, type LogEntry } from "@/src/api";
import { KIND, shedLabel } from "@/src/format";
import { Icon } from "@/src/components/Icon";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

function eventStyle(colors: any, event: LogEntry["event"]) {
  switch (event) {
    case "acknowledged":
      return { icon: "check-circle", color: colors.success, label: "Acknowledged" };
    case "escalated":
      return { icon: "alert-circle", color: colors.warning, label: "Re-alerted" };
    default:
      return { icon: "bell", color: colors.brandPrimary, label: "Fired" };
  }
}

function whenLabel(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  });
}

export default function LogScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();

  const { data, isLoading } = useQuery<LogEntry[]>({
    queryKey: qk.log,
    queryFn: () => api.get("/alarms/log"),
    refetchInterval: 10000,
  });

  const log = data ?? [];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.h1}>Activity Log</Text>
        <Text style={styles.h2}>Every alarm, re-alert and acknowledgement</Text>
      </View>

      <FlatList
        data={log}
        keyExtractor={(l) => l.id}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.sm }}
        renderItem={({ item }) => {
          const es = eventStyle(colors, item.event);
          const meta = KIND[item.kind];
          return (
            <View style={styles.row} testID={`log-${item.id}`}>
              <View style={[styles.iconBox, { backgroundColor: colors.surfaceTertiary }]}>
                <Icon name={es.icon} size={20} color={es.color} />
              </View>
              <View style={styles.body}>
                <Text style={styles.title}>
                  {meta.short} · {shedLabel(item.farm, item.shed)}
                </Text>
                <Text style={[styles.event, { color: es.color }]}>{es.label}</Text>
              </View>
              <Text style={styles.when}>{whenLabel(item.at)}</Text>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyWrap} testID="empty-log">
            <Icon name="clipboard-text-clock-outline" size={48} color={colors.muted} />
            <Text style={styles.emptyTitle}>{isLoading ? "Loading…" : "Nothing logged yet"}</Text>
            <Text style={styles.emptyBody}>
              As alarms fire and you tap Done, everything is recorded here so nothing slips.
            </Text>
          </View>
        }
      />
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  iconBox: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  body: { flex: 1 },
  title: { fontFamily: fonts.textSemiBold, color: colors.onSurface, fontSize: 15 },
  event: { fontFamily: fonts.textMedium, fontSize: 13, marginTop: 2 },
  when: { fontFamily: fonts.text, color: colors.muted, fontSize: 12 },
  emptyWrap: { alignItems: "center", paddingTop: spacing["3xl"], gap: spacing.sm },
  emptyTitle: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 22, marginTop: spacing.sm },
  emptyBody: { fontFamily: fonts.text, color: colors.muted, fontSize: 14, textAlign: "center", paddingHorizontal: spacing.xl, lineHeight: 20 },
}));
