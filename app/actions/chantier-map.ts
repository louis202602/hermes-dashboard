"use server";

import type { ChantierMapData } from "@/lib/dashboard/chantierMap";
import { getChantiersMap } from "@/services/hermes/chantierMap";
import { getCurrentWeather } from "@/services/hermes/contextBar";

/**
 * CARTE-1 server actions. The map widget is opt-in + lazy, so it fetches its own
 * data on mount (the dashboard pays nothing when the widget is hidden). Tenant
 * scoping is enforced in the RPC. No LLM.
 */
export async function getChantiersMapAction(): Promise<ChantierMapData> {
  const res = await getChantiersMap();
  return res.ok
    ? res.data
    : { resolutionStatus: "UNAVAILABLE", tenantId: null, points: [] };
}

export type ChantierWeather = {
  temperatureC: number;
  condition: string;
  icon: string;
  precipitationMm: number | null;
  windKph: number | null;
} | null;

/**
 * Worksite weather from the SAME lat/lon as the map marker (no second geocoding).
 * Reuses the cached Open-Meteo service; `timezone: "auto"` lets Open-Meteo infer the
 * zone from the coordinates. Called lazily on popup open — never per render.
 */
export async function getChantierWeatherAction(
  latitude: number,
  longitude: number,
): Promise<ChantierWeather> {
  const res = await getCurrentWeather(latitude, longitude, "auto");
  if (!res.ok || res.provenance !== "REAL") return null;
  const s = res.data;
  return {
    temperatureC: s.temperatureC,
    condition: s.condition,
    icon: s.icon,
    precipitationMm: s.precipitationMm,
    windKph: s.windKph,
  };
}
