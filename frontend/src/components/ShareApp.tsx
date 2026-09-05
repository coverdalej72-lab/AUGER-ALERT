import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { useQuery } from "@tanstack/react-query";

import { appOrigin, fetchShareQr } from "@/src/api";
import { Card } from "@/src/components/ui";
import { Icon } from "@/src/components/Icon";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export function ShareApp() {
  const { colors } = useTheme();
  const styles = useStyles();
  const [copied, setCopied] = useState(false);

  const link = appOrigin();
  const { data } = useQuery({
    queryKey: ["share-qr", link],
    queryFn: () => fetchShareQr(link),
    enabled: !!link,
  });

  const copy = async () => {
    try {
      if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // ignore
    }
  };

  return (
    <Card testID="share-panel">
      <View style={styles.head}>
        <View style={[styles.iconWrap, { backgroundColor: colors.brandTertiary }]}>
          <Icon name="qrcode" size={22} color={colors.brandPrimary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Share this app</Text>
          <Text style={styles.sub}>Anyone scans the code with their phone camera — no install.</Text>
        </View>
      </View>

      {data?.qr_data_url ? (
        <View style={styles.qrWrap}>
          <Image source={{ uri: data.qr_data_url }} style={styles.qr} contentFit="contain" />
        </View>
      ) : null}

      <Text style={styles.linkLabel}>Link</Text>
      <View style={styles.linkRow}>
        <Text style={styles.link} numberOfLines={1} selectable testID="share-link">
          {link}
        </Text>
        {Platform.OS === "web" ? (
          <Pressable onPress={copy} style={styles.copyBtn} testID="share-copy">
            <Icon name={copied ? "check" : "content-copy"} size={16} color={copied ? colors.success : colors.brandPrimary} />
            <Text style={[styles.copyText, copied && { color: colors.success }]}>{copied ? "Copied" : "Copy"}</Text>
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}

const useStyles = makeStyles((colors) => ({
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  iconWrap: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: fonts.textSemiBold, color: colors.onSurface, fontSize: 16 },
  sub: { fontFamily: fonts.text, color: colors.muted, fontSize: 12, marginTop: 2, lineHeight: 16 },
  qrWrap: {
    alignSelf: "center",
    backgroundColor: colors.surfaceInverse,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginTop: spacing.md,
  },
  qr: { width: 168, height: 168 },
  linkLabel: { fontFamily: fonts.textSemiBold, color: colors.onSurface, fontSize: 12, marginTop: spacing.md, marginBottom: spacing.xs },
  linkRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  link: {
    flex: 1,
    fontFamily: fonts.text,
    color: colors.onSurfaceSecondary,
    fontSize: 13,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.brandPrimary,
  },
  copyText: { fontFamily: fonts.textSemiBold, color: colors.brandPrimary, fontSize: 13 },
}));
