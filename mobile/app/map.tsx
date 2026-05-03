import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, type Region } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState } from "../src/components/EmptyState";
import { useSearch } from "../src/hooks/useSearch";
import { useTaxonomy, labelFor } from "../src/hooks/useTaxonomy";
import { useFilters } from "../src/state/filters";
import { colors, radius, spacing } from "../src/theme";

export default function MapScreen() {
  const router = useRouter();
  const { taxonomy } = useTaxonomy();
  const { filters } = useFilters();
  const { data, loading } = useSearch(filters);

  const points = useMemo(() => {
    return (data?.items ?? []).filter(
      (it) => it.church.latitude != null && it.church.longitude != null,
    );
  }, [data]);

  const initialRegion: Region = useMemo(() => {
    if (filters.latitude != null && filters.longitude != null) {
      return {
        latitude: filters.latitude,
        longitude: filters.longitude,
        latitudeDelta: 0.2,
        longitudeDelta: 0.2,
      };
    }
    if (points.length > 0) {
      const lat = points[0].church.latitude as number;
      const lon = points[0].church.longitude as number;
      return { latitude: lat, longitude: lon, latitudeDelta: 0.2, longitudeDelta: 0.2 };
    }
    // France-centered default.
    return { latitude: 46.6, longitude: 2.5, latitudeDelta: 8, longitudeDelta: 8 };
  }, [filters.latitude, filters.longitude, points]);

  if (!loading && points.length === 0) {
    return (
      <SafeAreaView style={styles.safe}>
        <EmptyState
          title="Aucun lieu géolocalisé"
          hint="Ajuste les filtres ou élargis le rayon."
        />
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.safe}>
      <MapView style={StyleSheet.absoluteFillObject} initialRegion={initialRegion}>
        {points.map((it) => (
          <Marker
            key={it.church.id}
            coordinate={{
              latitude: it.church.latitude as number,
              longitude: it.church.longitude as number,
            }}
            title={it.church.name}
            description={`${labelFor(taxonomy?.church_types, it.church.type)} · ${it.church.city ?? ""}`}
            pinColor={colors.accent}
            onCalloutPress={() => router.push(`/church/${it.church.id}`)}
          />
        ))}
      </MapView>

      <Pressable
        style={styles.fab}
        onPress={() => router.back()}
        accessibilityLabel="Retour à la liste"
      >
        <Ionicons name="list" size={20} color={colors.accent} />
        <Text style={styles.fabText}>Liste</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  fab: {
    position: "absolute",
    bottom: spacing.xl,
    right: spacing.lg,
    backgroundColor: colors.paper,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  fabText: { color: colors.accent, fontWeight: "600" },
});
