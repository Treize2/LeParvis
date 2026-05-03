import { StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "../theme";

type Props = {
  title: string;
  hint?: string;
};

export function EmptyState({ title, hint }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      {hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.xl, alignItems: "center" },
  title: { color: colors.ink, fontSize: 16, fontWeight: "600", marginBottom: spacing.xs },
  hint: { color: colors.inkSoft, fontSize: 13, textAlign: "center" },
});
