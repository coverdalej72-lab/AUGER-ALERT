import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { Icon } from "@/src/components/Icon";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

// "My farms" editor. `selected` are the grower's own farm names (arm alarms);
// `available` are farms detected in the latest uploaded sheet (quick-pick).
export function FarmManager({
  selected,
  available,
  onChange,
}: {
  selected: string[];
  available: string[];
  onChange: (next: string[]) => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [text, setText] = useState("");

  const add = (name: string) => {
    const n = name.trim();
    if (!n || selected.includes(n)) return;
    onChange([...selected, n]);
    setText("");
  };
  const remove = (name: string) => onChange(selected.filter((f) => f !== name));

  const suggestions = available.filter((f) => !selected.includes(f));

  return (
    <View style={{ gap: spacing.md }} testID="farm-manager">
      {selected.length ? (
        <View style={styles.chipWrap}>
          {selected.map((f) => (
            <Pressable key={f} onPress={() => remove(f)} style={styles.selChip} testID={`my-farm-${f}`}>
              <Icon name="check" size={13} color={colors.onBrandPrimary} />
              <Text style={styles.selChipText}>{f}</Text>
              <Icon name="close" size={13} color={colors.onBrandPrimary} />
            </Pressable>
          ))}
        </View>
      ) : (
        <Text style={styles.hint}>
          No farm set yet — add your farm name (e.g. Double B) so alarms fire only for your sheds.
        </Text>
      )}

      <View style={styles.inputRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Type your farm name"
          placeholderTextColor={colors.muted}
          style={styles.input}
          onSubmitEditing={() => add(text)}
          testID="add-farm-input"
        />
        <Pressable onPress={() => add(text)} style={styles.addBtn} testID="add-farm-button">
          <Icon name="plus" size={20} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      {suggestions.length ? (
        <View>
          <Text style={styles.subLabel}>From your latest sheet:</Text>
          <View style={styles.chipWrap}>
            {suggestions.map((f) => (
              <Pressable key={f} onPress={() => add(f)} style={styles.sugChip} testID={`suggest-farm-${f}`}>
                <Icon name="plus" size={12} color={colors.brandPrimary} />
                <Text style={styles.sugChipText}>{f}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  selChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  selChipText: { fontFamily: fonts.textSemiBold, color: colors.onBrandPrimary, fontSize: 14 },
  sugChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.brandPrimary,
  },
  sugChipText: { fontFamily: fonts.textMedium, color: colors.onBrandTertiary, fontSize: 14 },
  hint: { fontFamily: fonts.text, color: colors.muted, fontSize: 13, lineHeight: 19 },
  subLabel: { fontFamily: fonts.textMedium, color: colors.muted, fontSize: 12, marginBottom: spacing.sm },
  inputRow: { flexDirection: "row", gap: spacing.sm },
  input: {
    flex: 1,
    fontFamily: fonts.text,
    color: colors.onSurface,
    fontSize: 15,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  addBtn: {
    width: 48,
    borderRadius: radius.md,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
}));
