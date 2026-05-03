import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { FiltersProvider } from "../src/state/filters";
import { colors } from "../src/theme";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <FiltersProvider>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.paper },
            headerTintColor: colors.accent,
            headerTitleStyle: { fontWeight: "600" },
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="index" options={{ title: "LeParvis" }} />
          <Stack.Screen name="filters" options={{ presentation: "modal", title: "Filtres" }} />
          <Stack.Screen name="map" options={{ title: "Carte" }} />
          <Stack.Screen name="church/[id]" options={{ title: "" }} />
        </Stack>
      </FiltersProvider>
    </GestureHandlerRootView>
  );
}
