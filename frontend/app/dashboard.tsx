import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, API, qk, appOrigin, fetchRecipients, fetchPassStatus, type Alarm, type PassStatus, type Recipient, type Schedule, type Settings } from "@/src/api";
import { dateLabel, hhmm } from "@/src/format";
import { Card, Pill, PrimaryButton, SectionTitle, Stepper, fmtMins } from "@/src/components/ui";
import { FarmManager } from "@/src/components/FarmManager";
import { Paywall } from "@/src/components/Paywall";
import { ShareApp } from "@/src/components/ShareApp";
import { Icon } from "@/src/components/Icon";
import { getBillingEmail, setBillingEmail } from "@/src/utils/billing";
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
  const qc = useQueryClient();
  const [email, setEmailState] = useState<string | null>(null);

  useEffect(() => {
    getBillingEmail().then(setEmailState);
  }, []);

  const setEmail = useCallback(
    async (e: string) => {
      const n = e.trim().toLowerCase();
      await setBillingEmail(n);
      setEmailState(n);
      qc.invalidateQueries({ queryKey: qk.pass });
    },
    [qc],
  );

  const { data: pass, isLoading } = useQuery<PassStatus>({
    queryKey: [...qk.pass, email],
    queryFn: () => fetchPassStatus(email as string),
    enabled: !!email,
    refetchInterval: 15000,
  });

  if (email === null || (email && isLoading && !pass)) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View>
    );
  }

  if (email && pass?.active) return <DashboardInner />;

  return <Paywall savedEmail={email || ""} onSetEmail={setEmail} />;
}

function DashboardInner() {
  const { colors } = useTheme();
  const styles = useStyles();
  const qc = useQueryClient();

  const { data } = useQuery<Latest>({
    queryKey: qk.schedule,
    queryFn: () => api.get("/schedule/latest"),
    refetchInterval: 15000,
  });
  const { data: recipients } = useQuery<Recipient[]>({
    queryKey: qk.recipients,
    queryFn: fetchRecipients,
    refetchInterval: 10000,
  });
  const { data: settings } = useQuery<Settings>({ queryKey: qk.settings, queryFn: () => api.get("/settings") });

  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadInfo, setUploadInfo] = useState<{ shed_count: number; farms: string[]; filename: string } | null>(null);
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
        setUploadInfo({ shed_count: r.shed_count, farms: r.farms || [], filename: r.schedule?.source_filename || "sheet" });
        qc.invalidateQueries({ queryKey: qk.schedule });
        qc.invalidateQueries({ queryKey: qk.alarms });
      }
    },
    onError: (e: Error) => setUploadError(e.message),
  });

  const genManual = useMutation({
    mutationFn: (sheds: Draft[]) => api.post("/schedule/manual", sheds),
    onSuccess: (r: any) => {
      setDrafts([]);
      setUploadError(null);
      if (r) setUploadInfo({ shed_count: r.shed_count, farms: r.farms || [], filename: "Manual entry" });
      qc.invalidateQueries({ queryKey: qk.schedule });
      qc.invalidateQueries({ queryKey: qk.alarms });
    },
    onError: (e: Error) => setUploadError(e.message),
  });

  const [newManager, setNewManager] = useState("");
  const [qrOpen, setQrOpen] = useState<string | null>(null);

  const assignMut = useMutation({
    mutationFn: (recipient_id: string | null) => api.put("/schedule/assign", { recipient_id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.schedule });
      qc.invalidateQueries({ queryKey: qk.recipients });
    },
  });
  const addManagerMut = useMutation({
    mutationFn: (name: string) => api.post(`/recipients?app_url=${encodeURIComponent(appOrigin())}`, { name }),
    onSuccess: () => {
      setNewManager("");
      qc.invalidateQueries({ queryKey: qk.recipients });
    },
  });
  const removeManagerMut = useMutation({
    mutationFn: (id: string) => api.del(`/recipients/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.recipients });
      qc.invalidateQueries({ queryKey: qk.schedule });
    },
  });
  const regenManagerMut = useMutation({
    mutationFn: (id: string) => api.post(`/recipients/${id}/regenerate?app_url=${encodeURIComponent(appOrigin())}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.recipients }),
  });

  const delayMut = useMutation({
    mutationFn: (delay_min: number) => api.put("/schedule/delay", { delay_min }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.schedule });
      qc.invalidateQueries({ queryKey: qk.alarms });
    },
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
  const delay = schedule?.delay_min ?? 0;
  const myFarms = local?.my_farms ?? [];
  const byShed = new Map<string, Alarm[]>();
  alarms.forEach((a) => {
    const k = `${a.farm}|${a.shed}`;
    byShed.set(k, [...(byShed.get(k) ?? []), a]);
  });

  const isArmed = (farm: string) => (schedule?.farms?.length ? myFarms.includes(farm) : true);

  const shedStatus = (farm: string, shed: string) => {
    if (!isArmed(farm)) return { tone: "neutral" as const, label: "—" };
    const list = byShed.get(`${farm}|${shed}`) ?? [];
    if (!list.length) return { tone: "neutral" as const, label: "—" };
    const anyDue = list.some((a) => a.status === "pending" && new Date(a.fire_at_utc).getTime() <= Date.now());
    if (anyDue) return { tone: "error" as const, label: "Due" };
    if (list.every((a) => a.status === "acknowledged")) return { tone: "success" as const, label: "Done" };
    return { tone: "brand" as const, label: "Armed" };
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
          label={schedule?.assigned_name ? `On catch: ${schedule.assigned_name}` : "No-one assigned"}
          tone={schedule?.assigned_name ? "success" : "warning"}
          icon={schedule?.assigned_name ? "account-check" : "account-alert"}
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
            {schedule?.sheds.length ? (
              <View style={styles.delayBar} testID="delay-bar">
                <View style={styles.delayLeft}>
                  <Icon name="clock-alert-outline" size={18} color={delay > 0 ? colors.warning : colors.muted} />
                  <Text style={styles.delayLabel}>Running late?</Text>
                  <Text style={[styles.delayValue, { color: delay > 0 ? colors.warning : colors.muted }]} testID="delay-value">
                    {delay > 0 ? `+${fmtMins(delay)} delay` : "On time"}
                  </Text>
                </View>
                <View style={styles.delayRight}>
                  <Pressable onPress={() => delayMut.mutate(Math.max(0, delay - 30))} style={styles.delayBtn} testID="delay-minus">
                    <Icon name="minus" size={18} color={colors.onSurface} />
                  </Pressable>
                  <Pressable onPress={() => delayMut.mutate(delay + 30)} style={styles.delayBtn} testID="delay-plus">
                    <Icon name="plus" size={18} color={colors.onSurface} />
                  </Pressable>
                  <Pressable onPress={() => delayMut.mutate(delay + 60)} style={styles.delayChip} testID="delay-1h">
                    <Text style={styles.delayChipText}>+1h</Text>
                  </Pressable>
                  <Pressable onPress={() => delayMut.mutate(delay + 120)} style={styles.delayChip} testID="delay-2h">
                    <Text style={styles.delayChipText}>+2h</Text>
                  </Pressable>
                  {delay > 0 ? (
                    <Pressable onPress={() => delayMut.mutate(0)} style={styles.delayClear} testID="delay-clear">
                      <Text style={styles.delayClearText}>Clear</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ) : null}
            {uploadInfo ? (
              <View style={styles.okBanner} testID="upload-ok">
                <Icon name="check-decagram" size={16} color={colors.success} />
                <Text style={styles.okText}>
                  Auto-sorted {uploadInfo.shed_count} catches across {uploadInfo.farms.length} farm
                  {uploadInfo.farms.length === 1 ? "" : "s"} — catch, auger-off &amp; lines-up computed.
                  {myFarms.length
                    ? ` Alarms sent to phone for: ${myFarms.join(", ")}.`
                    : " Pick your farm under My farms to arm alarms."}
                </Text>
              </View>
            ) : null}
            {schedule?.note ? (
              <View style={styles.noteBanner} testID="sheet-note">
                <Icon name="information" size={16} color={colors.info} />
                <Text style={styles.noteText}>{schedule.note}</Text>
              </View>
            ) : null}
            {schedule?.farms?.length && myFarms.length === 0 ? (
              <View style={styles.armBanner} testID="arm-prompt">
                <Icon name="alert" size={16} color={colors.warning} />
                <Text style={styles.armText}>
                  Alarms are OFF — set your farm under &quot;My farms&quot; on the right to arm them.
                </Text>
              </View>
            ) : null}
            <Card style={{ padding: 0 }} testID="times-table">
              <View style={[styles.trow, styles.thead]}>
                <Text style={[styles.th, styles.cFarm]}>FARM</Text>
                <Text style={[styles.th, styles.cShed]}>SHED</Text>
                <Text style={[styles.th, styles.cCol]}>CATCH</Text>
                <Text style={[styles.th, styles.cCol]}>AUGER OFF</Text>
                <Text style={[styles.th, styles.cCol]}>LINES UP</Text>
                <Text style={[styles.th, styles.cCol]}>HEADS-UP</Text>
                <Text style={[styles.th, styles.cStatus]}>STATUS</Text>
              </View>
              {schedule?.sheds.length ? (
                schedule.sheds.map((s, i) => {
                  const st = shedStatus(s.farm, s.shed);
                  const armed = isArmed(s.farm);
                  return (
                    <View
                      key={s.farm + s.shed + i}
                      style={[styles.trow, i % 2 ? styles.rowAlt : null, !armed && { opacity: 0.45 }]}
                      testID={`shed-row-${s.shed}`}
                    >
                      <Text style={[styles.td, styles.cFarm, styles.tdFarm]} numberOfLines={1}>
                        {s.farm || "—"}
                      </Text>
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
            <SectionTitle>Share &amp; QR</SectionTitle>
            <ShareApp />
          </View>
          <View>
            <SectionTitle>Tonight&apos;s catch — who&apos;s on?</SectionTitle>
            <Card testID="crew-panel">
              {recipients && recipients.length ? (
                <View style={styles.crewChips}>
                  {recipients.map((r) => {
                    const on = schedule?.assigned_to === r.id;
                    return (
                      <Pressable
                        key={r.id}
                        onPress={() => assignMut.mutate(on ? null : r.id)}
                        style={[styles.crewChip, on && styles.crewChipOn]}
                        testID={`assign-${r.id}`}
                      >
                        <Icon name={on ? "account-check" : "account"} size={16} color={on ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
                        <Text style={[styles.crewChipText, on && { color: colors.onBrandPrimary }]}>{r.name}</Text>
                        {r.paired ? <View style={styles.pairedDot} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <Text style={styles.qrHint}>
                  Add each manager below. They pair their phone once, then you just pick who&apos;s on each night.
                </Text>
              )}
              <Text style={styles.assignNote}>
                {schedule
                  ? schedule.assigned_name
                    ? `Alarms go to ${schedule.assigned_name}'s phone only.`
                    : "Pick a manager to send tonight's alarms to their phone."
                  : "Upload a catch sheet first, then pick who's on."}
              </Text>

              {recipients && recipients.length ? (
                <>
                  <View style={styles.divider} />
                  <Text style={styles.subHead}>MANAGERS (PAIR ONCE)</Text>
                  {recipients.map((r) => (
                    <View key={r.id} style={styles.mgrRow} testID={`manager-${r.id}`}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.mgrName}>{r.name}</Text>
                        <Text style={styles.mgrStatus}>
                          {r.paired ? `Paired · ${r.device_name}` : `Not paired · code ${r.code}`}
                        </Text>
                      </View>
                      <Pressable onPress={() => setQrOpen(qrOpen === r.id ? null : r.id)} style={styles.mgrBtn} testID={`qr-${r.id}`}>
                        <Icon name="qrcode" size={18} color={colors.onSurface} />
                      </Pressable>
                      <Pressable onPress={() => removeManagerMut.mutate(r.id)} style={styles.mgrBtn} testID={`remove-${r.id}`}>
                        <Icon name="trash-can-outline" size={18} color={colors.error} />
                      </Pressable>
                    </View>
                  ))}
                  {qrOpen && recipients.find((x) => x.id === qrOpen) ? (
                    <View style={styles.qrWrap} testID="manager-qr">
                      <Image source={{ uri: recipients.find((x) => x.id === qrOpen)!.qr_data_url }} style={styles.qr} contentFit="contain" />
                      <Text style={styles.qrHint}>Scan once with the phone camera, or type this code:</Text>
                      <Text style={styles.code}>{recipients.find((x) => x.id === qrOpen)!.code}</Text>
                      <PrimaryButton label="New code" icon="refresh" tone="ghost" onPress={() => regenManagerMut.mutate(qrOpen)} testID="regen-manager" />
                    </View>
                  ) : null}
                </>
              ) : null}

              <View style={styles.mgrAddRow}>
                <TextInput
                  value={newManager}
                  onChangeText={setNewManager}
                  placeholder="Add manager name"
                  placeholderTextColor={colors.muted}
                  style={styles.mgrInput}
                  onSubmitEditing={() => newManager.trim() && addManagerMut.mutate(newManager.trim())}
                  testID="add-manager-input"
                />
                <PrimaryButton
                  label="Add"
                  icon="account-plus"
                  tone="ghost"
                  onPress={() => newManager.trim() && addManagerMut.mutate(newManager.trim())}
                  testID="add-manager-button"
                />
              </View>
            </Card>
          </View>

          {local ? (
            <View>
              <SectionTitle>My farms (arm alarms)</SectionTitle>
              <Card testID="my-farms-panel">
                <FarmManager
                  selected={local.my_farms}
                  available={schedule?.farms ?? []}
                  onChange={(next) => set({ my_farms: next })}
                />
                <View style={{ height: spacing.md }} />
                <PrimaryButton
                  label={saveSettings.isPending ? "Saving…" : saved ? "Saved ✓" : "Save & arm"}
                  icon={saved ? "check" : "content-save"}
                  tone={saved ? "success" : "brand"}
                  onPress={() => saveSettings.mutate(local)}
                  testID="d-save-farms"
                />
              </Card>
            </View>
          ) : null}

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

  noteBanner: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderLeftWidth: 3, borderLeftColor: colors.info,
    padding: spacing.md, borderRadius: radius.sm,
  },
  okBanner: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm,
    backgroundColor: colors.brandTertiary, borderLeftWidth: 3, borderLeftColor: colors.success,
    padding: spacing.md, borderRadius: radius.sm,
  },
  okText: { fontFamily: fonts.textMedium, color: colors.onBrandTertiary, fontSize: 13, flex: 1, lineHeight: 18 },

  delayBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap",
    gap: spacing.sm, marginBottom: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  delayLeft: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  delayRight: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  delayLabel: { fontFamily: fonts.textMedium, color: colors.onSurfaceSecondary, fontSize: 14 },
  delayValue: { fontFamily: fonts.textSemiBold, fontSize: 14 },
  delayBtn: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  delayChip: { paddingHorizontal: spacing.md, height: 36, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  delayChipText: { fontFamily: fonts.textSemiBold, color: colors.onBrandTertiary, fontSize: 14 },
  delayClear: { paddingHorizontal: spacing.md, height: 36, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  delayClearText: { fontFamily: fonts.textSemiBold, color: colors.error, fontSize: 14 },
  noteText: { fontFamily: fonts.textMedium, color: colors.onSurfaceSecondary, fontSize: 13, flex: 1 },
  armBanner: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderLeftWidth: 3, borderLeftColor: colors.warning,
    padding: spacing.md, borderRadius: radius.sm,
  },
  armText: { fontFamily: fonts.textMedium, color: colors.warning, fontSize: 13, flex: 1 },

  trow: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  thead: { borderBottomWidth: 1, borderBottomColor: colors.border },
  th: { fontFamily: fonts.textBold, color: colors.muted, fontSize: 11, letterSpacing: 1 },
  rowAlt: { backgroundColor: colors.surfaceTertiary },
  td: { fontFamily: fonts.textMedium, color: colors.onSurfaceSecondary, fontSize: 18 },
  tdShed: { fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 22 },
  tdAccent: { color: colors.brandPrimary, fontFamily: fonts.textSemiBold },
  tdFarm: { color: colors.onSurface, fontFamily: fonts.textSemiBold, fontSize: 14 },
  cFarm: { flex: 1.4, paddingRight: spacing.sm },
  cShed: { width: 56 },
  cCol: { flex: 1 },
  cStatus: { width: 80, alignItems: "flex-start" },
  tableEmpty: { alignItems: "center", gap: spacing.md, padding: spacing["3xl"] },
  tableEmptyText: { fontFamily: fonts.text, color: colors.muted, fontSize: 14, textAlign: "center", maxWidth: 320 },

  qrWrap: { alignItems: "center", marginBottom: spacing.md, marginTop: spacing.md, gap: spacing.xs },
  crewChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm },
  crewChip: {
    flexDirection: "row", alignItems: "center", gap: spacing.xs,
    backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill,
  },
  crewChipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  crewChipText: { fontFamily: fonts.textSemiBold, color: colors.onSurfaceSecondary, fontSize: 14 },
  pairedDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  assignNote: { fontFamily: fonts.text, color: colors.muted, fontSize: 12, lineHeight: 17 },
  subHead: { fontFamily: fonts.textBold, color: colors.muted, fontSize: 11, letterSpacing: 1.2, marginBottom: spacing.sm },
  mgrRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  mgrName: { fontFamily: fonts.textSemiBold, color: colors.onSurface, fontSize: 15 },
  mgrStatus: { fontFamily: fonts.text, color: colors.muted, fontSize: 12, marginTop: 1 },
  mgrBtn: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  mgrAddRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, alignItems: "center" },
  mgrInput: {
    flex: 1, fontFamily: fonts.text, color: colors.onSurface, fontSize: 15,
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  qr: { width: 200, height: 200, backgroundColor: colors.surfaceInverse, borderRadius: radius.md, padding: spacing.sm },
  qrHint: { fontFamily: fonts.text, color: colors.muted, fontSize: 13, textAlign: "center" },
  code: {
    fontFamily: fonts.displayBold, color: colors.onSurface, fontSize: 44, letterSpacing: 8,
    textAlign: "center", marginVertical: spacing.sm,
  },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.xs },
}));
