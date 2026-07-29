export type HermesState =
  | "idle"
  | "listening"
  | "thinking"
  | "success"
  | "warning"
  | "error"
  | "offline";

export type HermesQuality = "low" | "medium" | "high" | "auto";

export type ResolvedQuality = "low" | "medium" | "high";

export type HermesHologramProps = {
  state?: HermesState;
  quality?: HermesQuality;
  className?: string;
  reducedMotion?: boolean;
};

export const STATE_COLORS: Record<HermesState, { core: string; ring: string; label: string }> = {
  idle: { core: "#38bdf8", ring: "#7dd3fc", label: "En ligne" },
  listening: { core: "#5ec8f5", ring: "#93ddfd", label: "À l'écoute" },
  thinking: { core: "#3b82f6", ring: "#818cf8", label: "En réflexion" },
  success: { core: "#2dd4bf", ring: "#5eead4", label: "Terminé" },
  warning: { core: "#f59e0b", ring: "#fbbf24", label: "Avertissement" },
  error: { core: "#c2703d", ring: "#e08a52", label: "Erreur" },
  offline: { core: "#64748b", ring: "#94a3b8", label: "Hors ligne" },
};

export const STATE_CONFIG: Record<HermesState, { speed: number; pulse: number; brightness: number }> = {
  idle: { speed: 1, pulse: 0.035, brightness: 1 },
  listening: { speed: 1.15, pulse: 0.045, brightness: 1.15 },
  thinking: { speed: 1.7, pulse: 0.05, brightness: 1.3 },
  success: { speed: 1.1, pulse: 0.06, brightness: 1.35 },
  warning: { speed: 1.2, pulse: 0.055, brightness: 1.2 },
  error: { speed: 1.3, pulse: 0.05, brightness: 1.15 },
  offline: { speed: 0.15, pulse: 0.01, brightness: 0.45 },
};

