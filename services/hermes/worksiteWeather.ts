import "server-only";

import { isActiveStatus } from "@/lib/dashboard/agenda";
import {
  classifyWorksiteWeather,
  type WorksiteWeather,
} from "@/lib/dashboard/worksiteWeather";
import { getChantiersMap } from "@/services/hermes/chantierMap";
import { getCurrentWeather } from "@/services/hermes/contextBar";

/**
 * DASH-4G — enriched per-worksite weather. Reuses the EXISTING geocoded coordinates
 * (`get_chantiers_map` / `btp_chantier_geo` — no new geocoding) and the EXISTING
 * Open-Meteo integration (`getCurrentWeather`, free, no key, 15-min fetch-cached).
 *
 * COST-FIRST: exactly ONE new DB read (the chantier-geo RPC); upstream weather is
 * fetched once per UNIQUE coordinate (deduped, cached, shared across worksites and
 * viewers) — no polling, no schedule. Only ACTIVE worksites are considered, capped.
 */

const MAX_ACTIVE_WORKSITES = 16;

/** ~1 km bucket so nearby worksites share one cached upstream call. */
function coordKey(lat: number, lng: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

export async function getWorksiteWeather(): Promise<WorksiteWeather[]> {
  const map = await getChantiersMap();
  if (!map.ok || map.data.resolutionStatus !== "OK") return [];

  const active = map.data.points
    .filter((p) => isActiveStatus(p.status))
    .slice(0, MAX_ACTIVE_WORKSITES);
  if (active.length === 0) return [];

  // One upstream weather call per UNIQUE coordinate (deduped, cached).
  const uniques = new Map<string, { lat: number; lng: number }>();
  for (const p of active) {
    uniques.set(coordKey(p.latitude, p.longitude), { lat: p.latitude, lng: p.longitude });
  }
  const readings = new Map<string, Awaited<ReturnType<typeof getCurrentWeather>>>();
  await Promise.all(
    [...uniques.entries()].map(async ([key, c]) => {
      readings.set(key, await getCurrentWeather(c.lat, c.lng, "auto"));
    }),
  );

  const out: WorksiteWeather[] = [];
  for (const p of active) {
    const r = readings.get(coordKey(p.latitude, p.longitude));
    if (!r || !r.ok) continue; // no reading ⇒ skip (never fabricate)
    const w = r.data;
    out.push({
      chantierId: p.id,
      name: p.name,
      temperatureC: w.temperatureC,
      windKph: w.windKph,
      precipitationMm: w.precipitationMm,
      condition: w.condition,
      icon: w.icon,
      risks: classifyWorksiteWeather({
        temperatureC: w.temperatureC,
        windKph: w.windKph,
        precipitationMm: w.precipitationMm,
      }),
    });
  }
  return out;
}
