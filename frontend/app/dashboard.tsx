import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, API, qk, type Alarm, type PairingStatus, type Schedule, type Settings } from "@/src/api";
import { KIND, dateLabel, hhmm } from "@/src/format";
import { Card, Pill, PrimaryButton, SectionTitle, Stepper } from "@/src/components/ui";
import { Icon } from "@/src/components/Icon";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Latest = { schedule: Schedule | null; alarms: Alarm[] };
type Draft = { shed: string; catch_time: string };

async function pickAndUpload(): Promise<FormData | null> {
  const DocumentPicker = await import("expo-document-picker");
  const res = await DocumentPicker.getDocumentAsync({
    type: [
      "text/csv",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "*/*",
    ],
    copyToCacheDirectory: true,
  });
  if (res.canceled || !res.assets?.length) return null;
  const asset = res.assets[0];
  const fd = new FormData();
  if ((asset as any).file) {
    fd.append("file", (asset as any).file, asset.name);
  } else {
    fd.append("file", {
      uri: asset.uri,
      name: asset.name,
      type: asset.mimeType || "application/octet-stream",
    } as any);
  }
  return fd;
}

export default function Dashboard() {
  const { colors } = useTheme();
  const styles = useStyles();
  const qc = useQueryClient();

  const { data } = useQuery<Latest>({
    queryKey: qk.schedule,
    queryFn: () => api.get("/schedule/latest"),
    refetchInterval: 15000,
  });
  const { data: pairing } = useQuery<PairingStatus>({
    queryKey: qk.pairing,
    queryFn: () => api.get("/pairing"),
    refetchInterval: 10000,
  });
  const { data: settings } = useQuery<Settings>({ queryKey: qk.settings, queryFn: () => api.get("/settings") });

  const [uploadError, setUploadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [dShed, setDShed] = useState("");
  const [dTime, setDTime] = useState("");
  const [local, setLocal] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (settings && !local) setLocal(settings);
  }, [settings, local]);

  const upload = useMutation({
    mutationFn: async () => {
      const fd = await pickAndUpload();
      if (!fd) return null;
      const res = await fetch(`${API}/upload`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.detail || "Upload failed");
      }
      return res.json();
    },
    onSuccess: (r) => {
      if (r) {
        setUploadError(null);
        qc.invalidateQueries({ queryKey: qk.schedule });
        qc.invalidateQueries({ queryKey: qk.alarms });
      }
    },
    onError: (e: Error) => setUploadError(e.message),
  });

  const genManual = useMutation({
    mutationFn: (sheds: Draft[]) => api.post("/schedule/manual", sheds),
    onSuccess: () => {
      setDrafts([]);
      setUploadError(null);
      qc.invalidateQueries({ queryKey: qk.schedule });
      qc.invalidateQueries({ queryKey: qk.alarms });
    },
    onError: (e: Error) => setUploadError(e.message),
  });

  const regen = useMutation({
    mutationFn: () => api.post("/pairing/regenerate"),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.pairing }),
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
    setLocal((p) => (p ? { ...p, ...patch } : p));
    setSaved(false);
  };

  const schedule = data?.schedule ?? null;
  const alarms = data?.alarms ?? [];
  const byShed = new Map<string, Alarm[]>();
  alarms.forEach((a) => byShed.set(a.shed, [...(byShed.get(a.shed) ?? []), a]));

  const shedStatus = (shed: string) => {
    const list = byShed.get(shed) ?? [];
    if (!list.length) return { tone: "neutral" as const, label: "—" };
    const anyDue = list.some((a) => a.status === "pending" && new Date(a.fire_at_utc).getTime() <= Date.now());
    if (anyDue) return { tone: "error" as const, label: "Due" };
    if (list.every((a) => a.status === "acknowledged")) return { tone: "success" as const, label: "Done" };
    return { tone: "neutral" as const, label: "Set" };
  };

  const addDraft = () => {
    if (!dShed.trim() || !dTime.trim()) return;
    setDrafts((d) => [...d, { shed: dShed.trim(), catch_time: dTime.trim() }]);
    setDShed("");
    setDTime("");
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <View style={styles.brandRow}>
          <View style={styles.logo}>
            <Icon name="timer-alert" size={26} color={colors.brandPrimary} />
          </View>
          <View>
            <Text style={styles.h1}>Feed Withdrawal Control Centre</Text>
            <Text style={styles.h2}>
              {schedule
                ? `${dateLabel(schedule.catch_date)} · ${schedule.sheds.length} sheds · ${schedule.source_filename}`
                : "No schedule loaded"}
            </Text>
          </View>
        </View>
        <Pill
          label={pairing?.paired ? `Phone paired: ${pairing.device_name}` : "Phone not paired"}
          tone={pairing?.paired ? "success" : "warning"}
          icon={pairing?.paired ? "cellphone-link" : "cellphone-off"}
        />
      </View>

      <View style={styles.grid}>
        {/* MAIN */}
        <View style={styles.main}>
          {/* Upload */}
          <View>
            <SectionTitle>Catch sheet</SectionTitle>
            <Card testID="upload-card">
              <View style={styles.uploadRow}>
                <View style={styles.uploadIcon}>
                  <Icon name="file-upload-outline" size={28} color={colors.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.uploadTitle}>Upload today&apos;s catch sheet</Text>
                  <Text style={styles.uploadSub}>.xlsx or .csv from the processor</Text>
                </View>
                <PrimaryButton
                  label={upload.isPending ? "Reading…" : "Choose file"}
                  icon="upload"
                  onPress={() => upload.mutate()}
                  disabled={upload.isPending}
                  testID="upload-button"
                />
              </View>

              <View style={styles.orRow}>
                <View style={styles.orLine} />
                <Text style={styles.orText}>or add sheds manually</Text>
                <View style={styles.orLine} />
              </View>

              <View style={styles.manualRow}>
                <TextInput
                  value={dShed}
                  onChangeText={setDShed}
                  placeholder="Shed #"
                  placeholderTextColor={colors.muted}
                  style={[styles.manualInput, { flex: 1 }]}
                  testID="manual-shed-input"
                />
                <TextInput
                  value={dTime}
                  onChangeText={setDTime}
                  placeholder="Catch time e.g. 7:00"
                  placeholderTextColor={colors.muted}
                  style={[styles.manualInput, { flex: 1.4 }]}
                  onSubmitEditing={addDraft}
                  testID="manual-time-input"
                />
                <PrimaryButton label="Add" icon="plus" tone="ghost" onPress={addDraft} testID="manual-add-button" />
              </View>

              {drafts.length ? (
                <View style={styles.draftWrap}>
                  {drafts.map((d, i) => (
                    <Pill key={i} label={`Shed ${d.shed} · ${d.catch_time}`} tone="brand" icon="tractor-variant" />
                  ))}
                  <PrimaryButton
                    label={genManual.isPending ? "Generating…" : `Generate schedule (${drafts.length})`}
                    icon="cog-play"
                    onPress={() => genManual.mutate(drafts)}
                    disabled={genManual.isPending}
                    testID="generate-schedule-button"
                  />
                </View>
              ) : null}

              {uploadError ? (
                <View style={styles.errBanner} testID="upload-error">
                  <Icon name="alert-circle" size={18} color={colors.error} />
                  <Text style={styles.errBannerText}>{uploadError}</Text>
                </View>
              ) : null}
            </Card>
          </View>

          {/* Table */}
          <View>
            <SectionTitle>Per-shed withdrawal times</SectionTitle>
            <Card style={{ padding: 0 }} testID="times-table">
              <View style={[styles.trow, styles.thead]}>
                <Text style={[styles.th, styles.cShed]}>SHED</Text>
                <Text style={[styles.th, styles.cCol]}>CATCH</Text>
                <Text style={[styles.th, styles.cCol]}>AUGER OFF</Text>
                <Text style={[styles.th, styles.cCol]}>LINES UP</Text>
                <Text style={[styles.th, styles.cCol]}>HEADS-UP</Text>
                <Text style={[styles.th, styles.cStatus]}>STATUS</Text>
              </View>
              {schedule?.sheds.length ? (
                schedule.sheds.map((s, i) => {
                  const st = shedStatus(s.shed);
                  return (
                    <View key={s.shed + i} style={[styles.trow, i % 2 ? styles.rowAlt : null]} testID={`shed-row-${s.shed}`}>
                      <View style={styles.cShed}>
                        <Text style={styles.tdShed}>{s.shed}</Text>
                      </View>
                      <Text style={[styles.td, styles.cCol]}>{hhmm(s.catch_local)}</Text>
                      <Text style={[styles.td, styles.cCol, styles.tdAccent]}>{hhmm(s.auger_off_local)}</Text>
                      <Text style={[styles.td, styles.cCol]}>{hhmm(s.lines_up_local)}</Text>
                      <Text style={[styles.td, styles.cCol]}>
                        {(local?.catch_headsup_min ?? 30) > 0 ? hhmm(s.catch_headsup_local) : "—"}
                      </Text>
                      <View style={styles.cStatus}>
                        <Pill label={st.label} tone={st.tone} />
                      </View>
                    </View>
                  );
                })
              ) : (
                <View style={styles.tableEmpty} testID="table-empty">
                  <Icon name="table-large" size={40} color={colors.muted} />
                  <Text style={styles.tableEmptyText}>
                    Upload a catch sheet or add sheds manually to see computed times.
                  </Text>
                </View>
              )}
            </Card>
          </View>
        </View>

        {/* SIDEBAR */}
        <View style={styles.sidebar}>
          <View>
            <SectionTitle>Pair your phone</SectionTitle>
            <Card testID="pairing-panel">
              <View style={styles.qrWrap}>
                {pairing?.qr_data_url ? (
                  <Image source={{ uri: pairing.qr_data_url }} style={styles.qr} contentFit="contain" testID="pairing-qr" />
                ) : (
                  <View style={styles.qr} />
                )}
              </View>
              <Text style={styles.qrHint}>Scan in the phone app, or type this code:</Text>
              <Text style={styles.code} testID="pairing-code">{pairing?.code ?? "------"}</Text>
              {pairing?.paired ? (
                <Pill label={`Paired: ${pairing.device_name}`} tone="success" icon="check" />
              ) : (
                <Pill label="Waiting for phone…" tone="warning" icon="timer-sand" />
              )}
              <View style={{ height: spacing.md }} />
              <PrimaryButton label="New code" icon="refresh" tone="ghost" onPress={() => regen.mutate()} testID="regen-code-button" />
            </Card>
          </View>

          {local ? (
            <View>
              <SectionTitle>Offsets &amp; escalation</SectionTitle>
              <Card testID="settings-panel">
                <Stepper label="Auger OFF before" value={local.augers_offset_min} onChange={(v) => set({ augers_offset_min: v })} step={30} testID="d-augers" />
                <View style={styles.divider} />
                <Stepper label="Lines UP before" value={local.lines_offset_min} onChange={(v) => set({ lines_offset_min: v })} step={30} testID="d-lines" />
                <View style={styles.divider} />
                <Stepper label="Catch heads-up" value={local.catch_headsup_min} onChange={(v) => set({ catch_headsup_min: v })} step={5} testID="d-headsup" />
                <View style={styles.divider} />
                <Stepper label="Re-alert every" value={local.realert_interval_min} onChange={(v) => set({ realert_interval_min: v })} step={1} min={1} max={60} format={(v) => `${v} min`} testID="d-realert" />
                <View style={{ height: spacing.md }} />
                <PrimaryButton
                  label={saveSettings.isPending ? "Saving…" : saved ? "Saved ✓" : "Save & recompute"}
                  icon={saved ? "check" : "content-save"}
                  tone={saved ? "success" : "brand"}
                  onPress={() => saveSettings.mutate(local)}
                  testID="d-save"
                />
              </Card>
            </View>
          ) : null}
        </View>
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.xl, maxWidth: 1240, width: "100%", alignSelf: "center", gap: spacing.xl },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.md },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  logo: {
    width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.brandPrimary,
  },
  h1: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 30 },
  h2: { fontFamily: fonts.text, color: colors.muted, fontSize: 14, marginTop: 2 },

  grid: { flexDirection: "row", gap: spacing.xl, alignItems: "flex-start", flexWrap: "wrap" },
  main: { flex: 2, minWidth: 420, gap: spacing.xl },
  sidebar: { flex: 1, minWidth: 300, gap: spacing.xl },

  uploadRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  uploadIcon: {
    width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  uploadTitle: { fontFamily: fonts.textSemiBold, color: colors.onSurface, fontSize: 16 },
  uploadSub: { fontFamily: fonts.text, color: colors.muted, fontSize: 13, marginTop: 2 },
  orRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginVertical: spacing.lg },
  orLine: { flex: 1, height: 1, backgroundColor: colors.divider },
  orText: { fontFamily: fonts.text, color: colors.muted, fontSize: 12 },
  manualRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  manualInput: {
    fontFamily: fonts.text, color: colors.onSurface, fontSize: 15,
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  draftWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.lg, alignItems: "center" },
  errBanner: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md,
    backgroundColor: colors.surfaceTertiary, borderLeftWidth: 3, borderLeftColor: colors.error,
    padding: spacing.md, borderRadius: radius.sm,
  },
  errBannerText: { fontFamily: fonts.textMedium, color: colors.error, fontSize: 13, flex: 1 },

  trow: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  thead: { borderBottomWidth: 1, borderBottomColor: colors.border },
  th: { fontFamily: fonts.textBold, color: colors.muted, fontSize: 11, letterSpacing: 1 },
  rowAlt: { backgroundColor: colors.surfaceTertiary },
  td: { fontFamily: fonts.textMedium, color: colors.onSurfaceSecondary, fontSize: 18 },
  tdShed: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 22 },
  tdAccent: { color: colors.brandPrimary, fontFamily: fonts.textSemiBold },
  cShed: { width: 70 },
  cCol: { flex: 1 },
  cStatus: { width: 80, alignItems: "flex-start" },
  tableEmpty: { alignItems: "center", gap: spacing.md, padding: spacing["3xl"] },
  tableEmptyText: { fontFamily: fonts.text, color: colors.muted, fontSize: 14, textAlign: "center", maxWidth: 320 },

  qrWrap: { alignItems: "center", marginBottom: spacing.md },
  qr: { width: 200, height: 200, backgroundColor: colors.surfaceInverse, borderRadius: radius.md, padding: spacing.sm },
  qrHint: { fontFamily: fonts.text, color: colors.muted, fontSize: 13, textAlign: "center" },
  code: {
    fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 44, letterSpacing: 8,
    textAlign: "center", marginVertical: spacing.sm,
  },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.xs },
}));
