import {
  DEFAULT_CONTEXT_SETTINGS,
  resolveTimezone,
  resolveUnitPreferences,
} from "@/lib/dashboard/contextBar";
import { HERMES_DEFAULT_PREFERENCES } from "@/lib/dashboard/preferences";
import { hasPhotoStudio, photoGateKeys } from "@/lib/dashboard/photoAccess";
import {
  getCapabilitiesCached,
  getDashboardContextSettingsCached,
  getPhotoModuleStateCached,
} from "@/lib/dashboard/requestScope";
import { availableWidgetIds } from "@/lib/dashboard/widgets";
import { getDashboardUserPreferences } from "@/services/hermes/preferences";
import type { AvailableCapabilities, ServiceResult } from "@/types/hermes";

/**
 * Shared server-side context for every dashboard page (métier sub-pages + Home). Resolves
 * the user's locale / timezone / hour-cycle and the granted capabilities ONCE, from the
 * SAME cache()-shared reads as the chrome layout — so a sub-page adds no DB round-trip
 * (COST-FIRST). `available` is the canonical capability-gated widget/section set, reused
 * by pages to hide métier sections a tenant is not granted (capability-first).
 */
export async function resolvePageContext(): Promise<{
  prefs: typeof HERMES_DEFAULT_PREFERENCES;
  locale: string;
  country: string;
  timezone: string;
  hour12: boolean;
  capabilities: ServiceResult<AvailableCapabilities>;
  capabilityKeys: Set<string>;
  available: Set<string>;
  /** PHOTO-P0 — la verticale Studio est-elle activée pour ce tenant ? */
  photoEnabled: boolean;
}> {
  const [prefsResult, contextSettingsResult, capabilities, photoModule] = await Promise.all([
    getDashboardUserPreferences(),
    getDashboardContextSettingsCached(),
    getCapabilitiesCached(),
    getPhotoModuleStateCached(),
  ]);

  const prefs = prefsResult.ok ? prefsResult.data : HERMES_DEFAULT_PREFERENCES;
  const reg = prefs.regional;
  const tenantSettings = contextSettingsResult.ok
    ? contextSettingsResult.data
    : DEFAULT_CONTEXT_SETTINGS;
  const locale = reg.locale ?? tenantSettings.locale;
  const country = reg.country ?? tenantSettings.country;
  const tz = resolveTimezone({
    userTimezone: reg.timezone,
    tenantTimezone: tenantSettings.timezone,
  });
  const units = resolveUnitPreferences(locale, country, {
    ...(reg.hourCycle ? { hourCycle: reg.hourCycle } : {}),
  });
  // `capabilityKeys` = clés de PORTILLON (capacités réelles + activation photo).
  // La clé synthétique `photo.studio` n'exécute rien : elle n'ouvre que l'affichage.
  const capabilityKeys = photoGateKeys(
    capabilities.ok ? capabilities.data.capabilities.map((c) => c.actionKey) : [],
    photoModule.enabled,
  );

  return {
    prefs,
    locale,
    country,
    timezone: tz.timezone,
    hour12: units.hourCycle === "12h",
    capabilities,
    capabilityKeys,
    available: availableWidgetIds(capabilityKeys),
    photoEnabled: hasPhotoStudio(capabilityKeys),
  };
}
