import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing } from "../theme";
import type { TaxonomyItem } from "../types";

type Props = {
  items: TaxonomyItem[];
  selected: Set<string>;
  onToggle: (value: string) => void;
};

export function ChipRow({ items, selected, onToggle }: Props) {
  return (
    <View style={styles.row}>
      {items.map((it) => {
        const active = selected.has(it.value);
        return (
          <Pressable
            key={it.value}
            onPress={() => onToggle(it.value)}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>
              {it.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#fdfaf3",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  label: { color: colors.ink, fontSize: 13 },
  labelActive: { color: "#fff" },
});
