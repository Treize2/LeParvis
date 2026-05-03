import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { labelFor } from "../hooks/useTaxonomy";
import { colors, radius, spacing } from "../theme";
import type { Celebration, Church, Taxonomy } from "../types";
import { CelebrationLine } from "./CelebrationLine";

type Props = {
  church: Church;
  celebrations: Celebration[];
  distanceKm: number | null;
  taxonomy: Taxonomy | null;
};

const MAX_PREVIEW = 3;

function celebrationSortKey(c: Celebration): string {
  const dow = c.day_of_week ?? -1;
  return `${String(dow).padStart(2, "0")}-${c.start_time ?? ""}`;
}

export function ChurchCard({ church, celebrations, distanceKm, taxonomy }: Props) {
  const sorted = [...celebrations].sort((a, b) =>
    celebrationSortKey(a).localeCompare(celebrationSortKey(b)),
  );
  const preview = sorted.slice(0, MAX_PREVIEW);
  const more = sorted.length - preview.length;

  return (
    <Link href={`/church/${church.id}`} asChild>
      <Pressable style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.name} numberOfLines={2}>
            {church.name}
          </Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {labelFor(taxonomy?.church_types, church.type)}
            </Text>
          </View>
        </View>

        <Text style={styles.meta} numberOfLines={1}>
          {[church.postal_code, church.city].filter(Boolean).join(" · ")}
          {church.community
            ? ` — ${labelFor(taxonomy?.communities, church.community)}`
            : ""}
        </Text>

        <View style={styles.celebrations}>
          {preview.length === 0 && (
            <Text style={styles.empty}>Pas de célébration enregistrée.</Text>
          )}
          {preview.map((cel) => (
            <CelebrationLine
              key={cel.id}
              celebration={cel}
              celebrationTypes={taxonomy?.celebration_types}
            />
          ))}
          {more > 0 && (
            <Text style={styles.more}>+ {more} autres célébrations →</Text>
          )}
        </View>

        {distanceKm != null && (
          <Text style={styles.distance}>{distanceKm.toFixed(1)} km</Text>
        )}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.paper,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: spacing.md,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  name: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    color: colors.accent,
  },
  badge: {
    backgroundColor: colors.gold,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  badgeText: {
    color: "#fff",
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    fontWeight: "600",
  },
  meta: {
    color: colors.inkSoft,
    fontSize: 13,
    marginBottom: spacing.xs,
  },
  celebrations: { marginTop: spacing.xs },
  empty: { color: colors.inkSoft, fontStyle: "italic", fontSize: 13 },
  more: { color: colors.accent, fontSize: 13, marginTop: spacing.xs },
  distance: {
    position: "absolute",
    top: spacing.md,
    right: spacing.md,
    color: colors.inkSoft,
    fontSize: 12,
    fontStyle: "italic",
  },
});
