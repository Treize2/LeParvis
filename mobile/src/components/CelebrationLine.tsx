import { StyleSheet, Text, View } from "react-native";

import { colors, dayLabel, formatTime, spacing } from "../theme";
import type { Celebration, TaxonomyItem } from "../types";
import { labelFor } from "../hooks/useTaxonomy";

type Props = {
  celebration: Celebration;
  celebrationTypes?: TaxonomyItem[];
};

export function CelebrationLine({ celebration, celebrationTypes }: Props) {
  const extras: string[] = [];
  if (celebration.rite && celebration.rite !== "ordinary") {
    extras.push(celebration.rite);
  }
  if (celebration.language) extras.push(celebration.language.toUpperCase());

  return (
    <View style={styles.row}>
      <Text style={styles.time}>
        {dayLabel(celebration.day_of_week)} {formatTime(celebration.start_time)}
      </Text>
      <Text style={styles.label}>
        · {labelFor(celebrationTypes, celebration.type)}
      </Text>
      {extras.length > 0 && (
        <Text style={styles.extra}>({extras.join(", ")})</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.xs,
    flexWrap: "wrap",
    gap: 4,
  },
  time: { fontWeight: "600", color: colors.ink, fontSize: 14 },
  label: { color: colors.inkSoft, fontSize: 14 },
  extra: { color: colors.gold, fontSize: 12, marginLeft: 4 },
});
