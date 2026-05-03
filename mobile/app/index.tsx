import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { Link, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ChurchCard } from "../src/components/ChurchCard";
import { EmptyState } from "../src/components/EmptyState";
import { useSearch } from "../src/hooks/useSearch";
import { useTaxonomy } from "../src/hooks/useTaxonomy";
import { useFilters } from "../src/state/filters";
import { colors, radius, spacing } from "../src/theme";

export default function Home() {
  const router = useRouter();
  const { taxonomy } = useTaxonomy();
  const { filters, setFilters } = useFilters();
  const [query, setQuery] = useState(filters.q ?? "");
  const { data, loading, error, refresh } = useSearch(filters);

  const submitQuery = useCallback(() => {
    setFilters({ ...filters, q: query.trim() || undefined });
  }, [filters, query, setFilters]);

  const handleGeolocate = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Géolocalisation refusée", "Active-la dans les réglages.");
      return;
    }
    const pos = await Location.getCurrentPositionAsync({});
    setFilters({
      ...filters,
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      radius_km: filters.radius_km ?? 10,
    });
  }, [filters, setFilters]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <SafeAreaView edges={["bottom"]} style={styles.safe}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.inkSoft} />
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Rechercher un lieu, une ville…"
          placeholderTextColor={colors.inkSoft}
          returnKeyType="search"
          onSubmitEditing={submitQuery}
        />
        {query.length > 0 && (
          <Pressable onPress={() => { setQuery(""); setFilters({ ...filters, q: undefined }); }}>
            <Ionicons name="close-circle" size={18} color={colors.inkSoft} />
          </Pressable>
        )}
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.actionButton} onPress={() => router.push("/filters")}>
          <Ionicons name="options" size={16} color={colors.accent} />
          <Text style={styles.actionLabel}>Filtres</Text>
          <ActiveBadge filters={filters} />
        </Pressable>
        <Pressable style={styles.actionButton} onPress={handleGeolocate}>
          <Ionicons name="location" size={16} color={colors.accent} />
          <Text style={styles.actionLabel}>Près de moi</Text>
        </Pressable>
        <Link href="/map" asChild>
          <Pressable style={styles.actionButton}>
            <Ionicons name="map" size={16} color={colors.accent} />
            <Text style={styles.actionLabel}>Carte</Text>
          </Pressable>
        </Link>
      </View>

      <Text style={styles.resultLine}>
        {loading
          ? "Recherche…"
          : error
            ? `Erreur — ${error.message}`
            : `${total} résultat${total > 1 ? "s" : ""}`}
      </Text>

      <FlatList
        data={items}
        keyExtractor={(it) => String(it.church.id)}
        renderItem={({ item }) => (
          <ChurchCard
            church={item.church}
            celebrations={item.matched_celebrations}
            distanceKm={item.distance_km}
            taxonomy={taxonomy}
          />
        )}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.accent} />
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xxl }} />
          ) : (
            <EmptyState
              title="Aucun lieu trouvé"
              hint="Élargis le rayon ou retire des filtres."
            />
          )
        }
      />
    </SafeAreaView>
  );
}

function ActiveBadge({ filters }: { filters: Record<string, unknown> }) {
  const count = Object.entries(filters).filter(([k, v]) => {
    if (k === "q") return false;
    if (Array.isArray(v)) return v.length > 0;
    return v != null && v !== "";
  }).length;
  if (count === 0) return null;
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    margin: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
  },
  input: { flex: 1, color: colors.ink, fontSize: 16, paddingVertical: 4 },
  actions: {
    flexDirection: "row",
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
  },
  actionLabel: { color: colors.accent, fontSize: 13, fontWeight: "600" },
  badge: {
    backgroundColor: colors.accent,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  resultLine: {
    paddingHorizontal: spacing.md,
    color: colors.inkSoft,
    fontSize: 13,
    marginBottom: spacing.xs,
  },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl },
});
