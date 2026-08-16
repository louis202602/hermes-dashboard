/**
 * DASH-4G — Enriched per-worksite weather RISK classification (pure, DOM-free, no I/O,
 * no LLM). The raw readings come from the EXISTING Open-Meteo integration
 * (`getCurrentWeather`, 15-min fetch-cached, free, no key) applied to the EXISTING
 * geocoded worksite coordinates (`get_chantiers_map` / `btp_chantier_geo`) — no new
 * geocoding. This module only turns a reading into deterministic risk flags using
 * EXPLICIT, documented thresholds relevant to BTP outdoor work.
 */

import { isActiveStatus } from "@/lib/dashboard/agenda";

/**
 * Documented thresholds (BTP outdoor-work relevance) in CANONICAL internal units
 * (°C, km/h, mm) — the SAME units `getCurrentWeather` returns (Open-Meteo defaults).
 * Business rules ALWAYS compare in these units; any °F / mph display conversion happens
 * only at render, never before this check. Tune here — single source of truth.
 */
export const WORKSITE_WEATHER_THRESHOLDS = {
  heavyRainMm: 4, // ≥ 4 mm current precipitation — disrupts outdoor work
  strongWindKph: 40, // ≥ 40 km/h — crane / scaffold / lifting safety
  heatC: 33, // ≥ 33 °C — heat stress
  frostC: 0, // ≤ 0 °C — frost halts concrete / masonry
} as const;

/** Hard ceiling on distinct worksites we fetch weather for (bounds a big tenant). */
export const MAX_WORKSITE_WEATHER_LOCATIONS = 16;

export type WorksiteSelectable = {
  status: string | null;
  dateDebut: string | null;
  dateFin: string | null;
};

/**
 * ACTIVE_WORKSITE_RULE — a worksite qualifies for weather when its status is ACTIVE
 * (`isActiveStatus`: not DONE / TERMINÉ / ANNULÉ / REFUSÉ …). Invalid/0,0 coordinates
 * are already dropped upstream by `parseChantiersMap`. Among the actives we prioritise
 * the most time-relevant (soonest end date first, nulls last, then soonest start) and
 * cap at `max`, so a large tenant never triggers hundreds of weather calls.
 */
export function selectWorksitesForWeather<T extends WorksiteSelectable>(
  points: T[],
  max: number = MAX_WORKSITE_WEATHER_LOCATIONS,
): T[] {
  const cmp = (a: string | null, b: string | null): number => {
    if (a === b) return 0;
    if (!a) return 1; // nulls last
    if (!b) return -1;
    return a < b ? -1 : 1;
  };
  return points
    .filter((p) => isActiveStatus(p.status))
    .sort((a, b) => cmp(a.dateFin, b.dateFin) || cmp(a.dateDebut, b.dateDebut))
    .slice(0, Math.max(0, max));
}

export type WeatherRiskKind = "PLUIE_FORTE" | "VENT_FORT" | "CHALEUR" | "FROID";
export type WeatherRiskLevel = "WARNING" | "HIGH";

export type WeatherRisk = {
  kind: WeatherRiskKind;
  level: WeatherRiskLevel;
  value: number;
  unit: string;
};

export type WeatherReading = {
  temperatureC: number | null;
  windKph: number | null;
  precipitationMm: number | null;
};

export type WorksiteWeather = {
  chantierId: string;
  name: string;
  temperatureC: number | null;
  windKph: number | null;
  precipitationMm: number | null;
  condition: string;
  icon: string;
  risks: WeatherRisk[];
};

/** Deterministic risk flags for one reading (explicit thresholds; no LLM, no fetch). */
export function classifyWorksiteWeather(w: WeatherReading): WeatherRisk[] {
  const t = WORKSITE_WEATHER_THRESHOLDS;
  const risks: WeatherRisk[] = [];
  if (w.precipitationMm != null && w.precipitationMm >= t.heavyRainMm) {
    risks.push({ kind: "PLUIE_FORTE", level: "HIGH", value: w.precipitationMm, unit: "mm" });
  }
  if (w.windKph != null && w.windKph >= t.strongWindKph) {
    risks.push({ kind: "VENT_FORT", level: "HIGH", value: w.windKph, unit: "km/h" });
  }
  if (w.temperatureC != null && w.temperatureC >= t.heatC) {
    risks.push({ kind: "CHALEUR", level: "WARNING", value: w.temperatureC, unit: "°C" });
  }
  if (w.temperatureC != null && w.temperatureC <= t.frostC) {
    risks.push({ kind: "FROID", level: "WARNING", value: w.temperatureC, unit: "°C" });
  }
  return risks;
}

/** Overall worksite risk = the most severe risk present, or null when none. */
export function worksiteRiskLevel(risks: WeatherRisk[]): WeatherRiskLevel | null {
  if (risks.some((r) => r.level === "HIGH")) return "HIGH";
  if (risks.length > 0) return "WARNING";
  return null;
}

/** Worksites carrying at least one risk, HIGH first (stable). */
export function atRiskWorksites(list: WorksiteWeather[]): WorksiteWeather[] {
  return list
    .filter((w) => w.risks.length > 0)
    .sort((a, b) => {
      const ra = worksiteRiskLevel(a.risks) === "HIGH" ? 0 : 1;
      const rb = worksiteRiskLevel(b.risks) === "HIGH" ? 0 : 1;
      return ra - rb;
    });
}
