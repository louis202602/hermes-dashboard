"use server";

import type { WeatherSnapshot } from "@/lib/dashboard/contextBar";
import { getCurrentWeather } from "@/services/hermes/contextBar";

/**
 * DASH-4D — lazy context-bar weather. Called CLIENT-side only when a profile switch
 * makes a weather-dependent segment visible while the server hadn't fetched weather
 * (COST-FIRST: the initial profile hid it, so no upstream call was made). Reuses the
 * SAME cached Open-Meteo service — no new integration, no polling, one shot per switch.
 * Returns null (⇒ honest "unavailable") on any failure; never fabricates.
 */
export async function getContextWeatherAction(
  latitude: number,
  longitude: number,
  timezone: string,
): Promise<WeatherSnapshot | null> {
  const res = await getCurrentWeather(latitude, longitude, timezone || "auto");
  return res.ok && res.provenance === "REAL" ? res.data : null;
}
