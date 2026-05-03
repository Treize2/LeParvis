/**
 * Liturgical-inspired palette, mirrors the web frontend so users perceive
 * one product across surfaces.
 */
export const colors = {
  bg: "#f7f4ee",
  paper: "#ffffff",
  ink: "#2b2118",
  inkSoft: "#5a4a3c",
  accent: "#8b1a1a",
  accentSoft: "#b13a3a",
  gold: "#b78e3a",
  line: "#e6dfd4",
  shadow: "rgba(43, 33, 24, 0.12)",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  pill: 999,
};

export const fonts = {
  // Falls back to the platform serif so we don't need to bundle Cormorant.
  serif: "Georgia",
};

export const DAY_LABELS = [
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
  "Dimanche",
];

export function formatTime(value: string | null): string {
  if (!value) return "—";
  return value.slice(0, 5).replace(":", "h");
}

export function dayLabel(dow: number | null): string {
  if (dow == null) return "Quotidien";
  return DAY_LABELS[dow] ?? "—";
}
