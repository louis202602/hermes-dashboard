import "server-only";

import {
  DEFAULT_CONTEXT_SETTINGS,
  WEATHER_TTL_MS,
  parseWeather,
  type ContextSettings,
  type WeatherSnapshot,
} from "@/lib/dashboard/contextBar";
import { logEvent } from "@/lib/observability/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ServiceResult } from "@/types/hermes";

function toNumOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(n) ? n : null;
}

/**
 * Per-tenant international context (timezone / locale / country / currency +
 * optional city / coordinates) from `public.get_dashboard_context_settings`.
 * Tenant scoping is enforced inside the RPC. Anything unresolved collapses to the
 * neutral defaults — never a fabricated location.
 */
export async function getDashboardContextSettings(): Promise<
  ServiceResult<ContextSettings>
> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc(
      "get_dashboard_context_settings",
    );
    if (error) {
      logEvent("error", "context_settings.rpc_error", { code: error.code });
      return { ok: false, provenance: "UNAVAILABLE", error: error.message };
    }
    const p = (data ?? {}) as Record<string, unknown>;
    const status = String(p.resolution_status ?? "NO_TENANT");

    if (status !== "OK") {
      // Authenticated-but-no-tenant (or unauthenticated): honest neutral bar.
      return {
        ok: true,
        provenance: "REAL",
        data: { ...DEFAULT_CONTEXT_SETTINGS, resolutionStatus: status },
      };
    }

    const settings: ContextSettings = {
      resolutionStatus: "OK",
      tenantId: (p.tenant_id as string) ?? null,
      city: (p.city as string) ?? null,
      timezone: String(p.iana_timezone ?? "UTC"),
      latitude: toNumOrNull(p.latitude),
      longitude: toNumOrNull(p.longitude),
      locale: String(p.locale ?? "fr-FR"),
      country: String(p.country ?? "FR"),
      currency: String(p.currency ?? "EUR"),
      locationConfigured: Boolean(p.location_configured),
    };
    return { ok: true, provenance: "REAL", data: settings };
  } catch (e) {
    logEvent("error", "context_settings.exception", {
      message: e instanceof Error ? e.message : "unknown",
    });
    return { ok: false, provenance: "UNAVAILABLE", error: "context_settings" };
  }
}

/**
 * Current weather via **Open-Meteo** — free, no API key, no browser secret (the
 * call is server-side). Cached by Next's fetch cache for `WEATHER_TTL_MS` (15 min)
 * so it is never called per render. Returns UNAVAILABLE (`NO_LOCATION`) when no
 * coordinates are configured — no fabricated reading.
 */
export async function getCurrentWeather(
  latitude: number | null,
  longitude: number | null,
  timezone: string,
): Promise<ServiceResult<WeatherSnapshot>> {
  if (latitude === null || longitude === null) {
    return { ok: false, provenance: "UNAVAILABLE", error: "NO_LOCATION" };
  }
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(latitude));
    url.searchParams.set("longitude", String(longitude));
    url.searchParams.set(
      "current",
      "temperature_2m,weather_code,precipitation,wind_speed_10m",
    );
    url.searchParams.set("timezone", timezone);

    const res = await fetch(url, {
      // Server-side cache: one upstream call shared across viewers/renders.
      next: { revalidate: Math.floor(WEATHER_TTL_MS / 1000) },
    });
    if (!res.ok) {
      logEvent("error", "weather.http_error", { status: res.status });
      return {
        ok: false,
        provenance: "UNAVAILABLE",
        error: `weather_http_${res.status}`,
      };
    }
    const json = (await res.json()) as unknown;
    const snapshot = parseWeather(json);
    if (!snapshot) {
      return { ok: false, provenance: "UNAVAILABLE", error: "weather_parse" };
    }
    return { ok: true, provenance: "REAL", data: snapshot };
  } catch (e) {
    logEvent("error", "weather.exception", {
      message: e instanceof Error ? e.message : "unknown",
    });
    return { ok: false, provenance: "UNAVAILABLE", error: "weather_fetch" };
  }
}
