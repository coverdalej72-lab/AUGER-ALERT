import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";

import { api, qk, type Alarm, type PairingStatus, type Schedule } from "@/src/api";
import { KIND, dateLabel, hhmm, relative, shedLabel } from "@/src/format";
import { Icon } from "@/src/components/Icon";
import { Pill } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Latest = { schedule: Schedule | null; alarms: Alarm[] };

function statusPill(a: Alarm) {
  if (a.status === "acknowledged") return <Pill label="Done" tone="success" icon="check" />;
  const past = new Date(a.fire_at_utc).getTime() <= Date.now();
  if (past) return <Pill label="DUE NOW" tone="error" icon="bell-ring" />;
  return <Pill label={relative(a.fire_at_utc)} tone="neutral" icon="clock-outline" />;
}

export default function HomeScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading } = useQuery<Latest>({
    queryKey: qk.schedule,
    queryFn: () => api.get("/schedule/latest"),
    refetchInterval: 15000,
  });
  const { data: pairing } = useQuery<PairingStatus>({
    queryKey: qk.pairing,
    queryFn: () => api.get("/pairing"),
    refetchInterval: 15000,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await qc.invalidateQueries({ queryKey: qk.schedule });
    await qc.invalidateQueries({ queryKey: qk.pairing });
    setRefreshing(false);
  }, [qc]);

  const alarms = data?.alarms ?? [];
  const schedule = data?.schedule ?? null;
  const nextUp = alarms.find((a) => a.status === "pending");

  const renderItem = ({ item }: { item: Alarm }) => {
    const meta = KIND[item.kind];
    const done = item.status === "acknowledged";
    return (
      <View style={styles.row} testID={`event-${item.id}`}>
        <View style={styles.rail}>
          <View style={[styles.dot, { backgroundColor: done ? colors.success : colors.brandPrimary }]} />
          <View style={styles.railLine} />
        </View>
        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <Text style={styles.rowTime}>{hhmm(item.fire_at_local)}</Text>
            {statusPill(item)}
          </View>
          <View style={styles.rowActionWrap}>
            <Icon name={meta.icon} size={18} color={done ? colors.muted : colors.brandSecondary} />
            <Text style={[styles.rowAction, done && { color: colors.muted }]}>{meta.action}</Text>
          </View>
          <Text style={styles.rowShed}>{shedLabel(item.farm, item.shed)}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.h1}>Withdrawal Timer</Text>
          <Text style={styles.h2}>
            {schedule ? dateLabel(schedule.catch_date) + " · catch schedule" : "No schedule loaded"}
          </Text>
        </View>
        <Pressable testID="paired-chip">
          <Pill
            label={pairing?.paired ? "Paired" : "Not paired"}
            tone={pairing?.paired ? "success" : "warning"}
            icon={pairing?.paired ? "cellphone-link" : "cellphone-off"}
          />
        </Pressable>
      </View>

      <FlatList
        data={alarms}
        keyExtractor={(a) => a.id}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />
        }
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.xs }}
        ListHeaderComponent={
          nextUp ? (
            <View style={styles.hero} testID="next-up-card">
              <Text style={styles.heroLabel}>NEXT UP</Text>
              <Text style={styles.heroAction}>{KIND[nextUp.kind].action}</Text>
              <View style={styles.heroMeta}>
                <Text style={styles.heroShed}>{shedLabel(nextUp.farm, nextUp.shed)}</Text>
                <Text style={styles.heroTime}>{hhmm(nextUp.fire_at_local)}</Text>
              </View>
              <Text style={styles.heroRel}>{relative(nextUp.fire_at_utc)}</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          isLoading ? (
            <Text style={styles.empty}>Loading…</Text>
          ) : (
            <View style={styles.emptyWrap} testID="empty-schedule">
              <Image
                source={{
                  uri: "https://images.unsplash.com/photo-1683357352694-5dc72afdc425?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDk1ODF8MHwxfHNlYXJjaHwyfHxhYnN0cmFjdCUyMGRhcmslMjBhbGFybSUyMGNsb2NrJTIwb3IlMjB0aW1lcnxlbnwwfHx8fDE3ODg1MTc2ODR8MA&ixlib=rb-4.1.0&q=85",
                }}
                style={styles.emptyImg}
                contentFit="cover"
              />
              <Text style={styles.emptyTitle}>No schedule yet</Text>
              <Text style={styles.emptyBody}>
                Open the control centre on your PC, upload today&apos;s catch sheet, then scan the QR
                in Settings to pair this phone.
              </Text>
            </View>
          )
        }
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  h1: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 26 },
  h2: { fontFamily: fonts.text, color: colors.muted, fontSize: 13, marginTop: 2 },

  hero: {
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.brandPrimary,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  heroLabel: { fontFamily: fonts.textBold, color: colors.brandSecondary, fontSize: 12, letterSpacing: 2 },
  heroAction: {
    fontFamily: fonts.displayBold,
    color: colors.onBrandTertiary,
    fontSize: 30,
    marginTop: spacing.xs,
    textTransform: "uppercase",
  },
  heroMeta: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: spacing.sm },
  heroShed: { fontFamily: fonts.textSemiBold, color: colors.onBrandTertiary, fontSize: 16 },
  heroTime: { fontFamily: fonts.displayBold, color: colors.brandPrimary, fontSize: 34 },
  heroRel: { fontFamily: fonts.text, color: colors.brandSecondary, fontSize: 14, marginTop: 2 },

  row: { flexDirection: "row", gap: spacing.md },
  rail: { width: 16, alignItems: "center" },
  dot: { width: 12, height: 12, borderRadius: 6, marginTop: 6 },
  railLine: { flex: 1, width: 2, backgroundColor: colors.border, marginTop: 2 },
  rowBody: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowTime: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 28 },
  rowActionWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs },
  rowAction: { fontFamily: fonts.textSemiBold, color: colors.onSurfaceSecondary, fontSize: 16 },
  rowShed: { fontFamily: fonts.text, color: colors.muted, fontSize: 13, marginTop: 2 },

  empty: { color: colors.muted, textAlign: "center", marginTop: spacing.xl, fontFamily: fonts.text },
  emptyWrap: { alignItems: "center", paddingTop: spacing.xl, gap: spacing.md },
  emptyImg: { width: 160, height: 160, borderRadius: radius.lg, opacity: 0.8 },
  emptyTitle: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 24 },
  emptyBody: { fontFamily: fonts.text, color: colors.muted, fontSize: 15, textAlign: "center", lineHeight: 22, paddingHorizontal: spacing.lg },
}));
