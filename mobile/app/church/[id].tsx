import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { celebrationIcsUrl, getChurch } from "../../src/api";
import { CelebrationLine } from "../../src/components/CelebrationLine";
import { EmptyState } from "../../src/components/EmptyState";
import { labelFor, useTaxonomy } from "../../src/hooks/useTaxonomy";
import { colors, radius, spacing } from "../../src/theme";
import type { ChurchDetail } from "../../src/types";

export default function ChurchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const churchId = Number(id);
  const { taxonomy } = useTaxonomy();
  const [church, setChurch] = useState<ChurchDetail | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!Number.isFinite(churchId)) return;
    const ctrl = new AbortController();
    getChurch(churchId, ctrl.signal)
      .then(setChurch)
      .catch((err: Error) => {
        if (!ctrl.signal.aborted) setError(err);
      });
    return () => ctrl.abort();
  }, [churchId]);

  if (error) {
    return (
      <SafeAreaView style={styles.safe}>
        <EmptyState title="Lieu introuvable" hint={error.message} />
      </SafeAreaView>
    );
  }
  if (!church) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xxl }} />
      </SafeAreaView>
    );
  }

  const groups = groupCelebrationsByType(church.celebrations);

  return (
    <SafeAreaView edges={["bottom"]} style={styles.safe}>
      <Stack.Screen options={{ title: church.name }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headerCard}>
          <Text style={styles.title}>{church.name}</Text>
          <Text style={styles.kind}>
            {labelFor(taxonomy?.church_types, church.type)}
            {church.community
              ? ` · ${labelFor(taxonomy?.communities, church.community)}`
              : ""}
          </Text>
          {church.diocese && (
            <Text style={styles.diocese}>Diocèse : {church.diocese}</Text>
          )}
          {church.description && (
            <Text style={styles.description}>{church.description}</Text>
          )}
        </View>

        <ContactRow
          icon="location-outline"
          label={[church.address, church.postal_code, church.city]
            .filter(Boolean)
            .join(", ")}
          onPress={() => openMaps(church)}
        />
        {church.phone && (
          <ContactRow
            icon="call-outline"
            label={church.phone}
            onPress={() => Linking.openURL(`tel:${church.phone}`)}
          />
        )}
        {church.email && (
          <ContactRow
            icon="mail-outline"
            label={church.email}
            onPress={() => Linking.openURL(`mailto:${church.email}`)}
          />
        )}
        {church.website && (
          <ContactRow
            icon="globe-outline"
            label={church.website}
            onPress={() => Linking.openURL(church.website as string)}
          />
        )}

        {groups.length === 0 && (
          <EmptyState
            title="Pas d'horaire enregistré"
            hint="Les célébrations apparaîtront ici dès que la base sera renseignée."
          />
        )}

        {groups.map(({ type, items }) => (
          <View key={type} style={styles.groupCard}>
            <Text style={styles.groupTitle}>
              {labelFor(taxonomy?.celebration_types, type)}
            </Text>
            {items.map((cel) => (
              <View key={cel.id} style={styles.celebrationRow}>
                <CelebrationLine
                  celebration={cel}
                  celebrationTypes={taxonomy?.celebration_types}
                />
                <Pressable
                  style={styles.icsButton}
                  onPress={() => Linking.openURL(celebrationIcsUrl(cel.id))}
                >
                  <Ionicons name="calendar-outline" size={14} color={colors.accent} />
                  <Text style={styles.icsLabel}>Ajouter</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function groupCelebrationsByType(items: ChurchDetail["celebrations"]) {
  const by = new Map<string, ChurchDetail["celebrations"]>();
  for (const c of items) {
    const arr = by.get(c.type) ?? [];
    arr.push(c);
    by.set(c.type, arr);
  }
  // Sort each group by (day_of_week, start_time).
  return Array.from(by.entries()).map(([type, list]) => ({
    type,
    items: [...list].sort((a, b) => {
      const da = a.day_of_week ?? -1;
      const db = b.day_of_week ?? -1;
      if (da !== db) return da - db;
      return (a.start_time ?? "").localeCompare(b.start_time ?? "");
    }),
  }));
}

function openMaps(church: ChurchDetail) {
  const query = encodeURIComponent(
    [church.name, church.address, church.city].filter(Boolean).join(", "),
  );
  if (church.latitude && church.longitude) {
    Linking.openURL(
      `https://maps.apple.com/?ll=${church.latitude},${church.longitude}&q=${query}`,
    );
  } else {
    Linking.openURL(`https://www.openstreetmap.org/search?query=${query}`);
  }
}

function ContactRow({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress?: () => void;
}) {
  if (!label) return null;
  return (
    <Pressable style={styles.contactRow} onPress={onPress}>
      <Ionicons name={icon} size={18} color={colors.accent} />
      <Text style={styles.contactLabel} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.md, paddingBottom: spacing.xxl },
  headerCard: {
    backgroundColor: colors.paper,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: spacing.md,
  },
  title: { fontSize: 22, fontWeight: "700", color: colors.accent },
  kind: { color: colors.inkSoft, marginTop: 4 },
  diocese: { color: colors.inkSoft, fontSize: 13, marginTop: 8 },
  description: {
    color: colors.ink,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.sm,
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    marginBottom: spacing.xs,
  },
  contactLabel: { flex: 1, color: colors.ink, fontSize: 14 },
  groupCard: {
    backgroundColor: colors.paper,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    marginTop: spacing.md,
  },
  groupTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.gold,
    marginBottom: spacing.xs,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  celebrationRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingVertical: 4,
  },
  icsButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  icsLabel: { color: colors.accent, fontSize: 12, fontWeight: "600" },
});
