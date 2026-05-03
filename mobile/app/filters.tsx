import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ChipRow } from "../src/components/ChipRow";
import { useTaxonomy } from "../src/hooks/useTaxonomy";
import { useFilters } from "../src/state/filters";
import { colors, radius, spacing } from "../src/theme";
import type { SearchFilters } from "../src/types";

const DAYS = [
  { value: "0", label: "Lun" },
  { value: "1", label: "Mar" },
  { value: "2", label: "Mer" },
  { value: "3", label: "Jeu" },
  { value: "4", label: "Ven" },
  { value: "5", label: "Sam" },
  { value: "6", label: "Dim" },
];

export default function FiltersScreen() {
  const router = useRouter();
  const { taxonomy } = useTaxonomy();
  const { filters: current, setFilters, reset } = useFilters();
  const [draft, setDraft] = useState<SearchFilters>({ ...current });

  function toggleArray(key: "type" | "celebration_type" | "rite" | "community", value: string) {
    setDraft((prev) => {
      const list = (prev[key] as string[] | undefined) ?? [];
      const next = list.includes(value)
        ? list.filter((v) => v !== value)
        : [...list, value];
      return { ...prev, [key]: next.length ? next : undefined };
    });
  }

  function apply() {
    setFilters(draft);
    router.back();
  }

  function handleReset() {
    reset();
    setDraft({});
  }

  if (!taxonomy) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.placeholder}>Chargement de la taxonomie…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["bottom"]} style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Section title="Type de lieu">
          <ChipRow
            items={taxonomy.church_types}
            selected={new Set(draft.type ?? [])}
            onToggle={(v) => toggleArray("type", v)}
          />
        </Section>

        <Section title="Type de célébration">
          <ChipRow
            items={taxonomy.celebration_types}
            selected={new Set(draft.celebration_type ?? [])}
            onToggle={(v) => toggleArray("celebration_type", v)}
          />
        </Section>

        <Section title="Communauté">
          <ChipRow
            items={taxonomy.communities}
            selected={new Set(draft.community ?? [])}
            onToggle={(v) => toggleArray("community", v)}
          />
        </Section>

        <Section title="Rite">
          <ChipRow
            items={taxonomy.rites}
            selected={new Set(draft.rite ?? [])}
            onToggle={(v) => toggleArray("rite", v)}
          />
        </Section>

        <Section title="Jour">
          <ChipRow
            items={DAYS}
            selected={
              draft.day_of_week !== undefined
                ? new Set([String(draft.day_of_week)])
                : new Set()
            }
            onToggle={(v) =>
              setDraft((prev) => ({
                ...prev,
                day_of_week:
                  prev.day_of_week === Number(v) ? undefined : Number(v),
              }))
            }
          />
        </Section>

        <Section title="Lieu">
          <View style={styles.row}>
            <TextInput
              style={styles.input}
              placeholder="Ville"
              placeholderTextColor={colors.inkSoft}
              value={draft.city ?? ""}
              onChangeText={(v) =>
                setDraft({ ...draft, city: v || undefined })
              }
            />
            <TextInput
              style={styles.input}
              placeholder="Code postal"
              placeholderTextColor={colors.inkSoft}
              keyboardType="number-pad"
              value={draft.postal_code ?? ""}
              onChangeText={(v) =>
                setDraft({ ...draft, postal_code: v || undefined })
              }
            />
          </View>
        </Section>

        <Section title="Rayon (km autour de moi)">
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            value={draft.radius_km != null ? String(draft.radius_km) : ""}
            placeholder="ex. 10"
            placeholderTextColor={colors.inkSoft}
            onChangeText={(v) =>
              setDraft({
                ...draft,
                radius_km: v ? Number(v) : undefined,
              })
            }
          />
        </Section>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={[styles.button, styles.secondary]} onPress={handleReset}>
          <Text style={[styles.buttonText, { color: colors.accent }]}>Effacer</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.primary]} onPress={apply}>
          <Text style={[styles.buttonText, { color: "#fff" }]}>Appliquer</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.md, paddingBottom: spacing.xxl },
  section: { marginBottom: spacing.lg },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.inkSoft,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  row: { flexDirection: "row", gap: spacing.sm },
  input: {
    flex: 1,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.ink,
  },
  footer: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.paper,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  button: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: "center",
  },
  primary: { backgroundColor: colors.accent },
  secondary: {
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  buttonText: { fontSize: 16, fontWeight: "600" },
  placeholder: {
    color: colors.inkSoft,
    textAlign: "center",
    marginTop: spacing.xxl,
  },
});
