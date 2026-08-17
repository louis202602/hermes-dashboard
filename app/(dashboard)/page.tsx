import CommandCenter from "@/components/dashboard/CommandCenter";
import {
  actionableAlertCount,
  nextEventForBar,
} from "@/lib/dashboard/agenda";
import {
  DEFAULT_CONTEXT_SETTINGS,
  buildContextBarModel,
  formatClock,
  resolveTimezone,
  resolveUnitPreferences,
} from "@/lib/dashboard/contextBar";
import { HERMES_DEFAULT_PREFERENCES } from "@/lib/dashboard/preferences";
import {
  availableProfiles,
  clampProfiles,
  deriveCapabilityTokens,
  effectiveProfileLayout,
  fallbackProfile,
} from "@/lib/dashboard/profiles";
import {
  getCapabilitiesCached,
  getDashboardContextSettingsCached,
  getUnifiedAlertsCached,
} from "@/lib/dashboard/requestScope";
import { resolveHomeProfile } from "@/lib/dashboard/shortcuts";
import {
  clampLayout,
  contextVisibleSegments,
  needsWeather,
  resolveContextConfig,
} from "@/lib/dashboard/widgets";
import { getDashboardAgenda } from "@/services/hermes/agenda";
import { getCurrentWeather } from "@/services/hermes/contextBar";
import { getPublicKpis } from "@/services/hermes/dashboard";
import {
  getCostGovernanceSnapshot,
  getObservabilitySnapshot,
  getOperationalPriorities,
  getPlatformHealth,
  getResolverObservability,
} from "@/services/hermes/panels";
import { getDashboardUserPreferences } from "@/services/hermes/preferences";
import { getAgentActionStats } from "@/services/hermes/systemActivity";
import { getActiveTenantIdentity } from "@/services/hermes/tenantIdentity";

/**
 * Command Center Home (route `/`, inside the (dashboard) group). The chrome is provided
 * by the group layout; this page fetches ONLY the content snapshots and renders the épuré
 * 6-zone cockpit. Compared to the previous Home it drops the projects, conversations,
 * audit, resolver-control and commercial reads (moved to future métier sub-pages) — so it
 * loads strictly LESS. No auth check here: the group layout owns the auth boundary and
 * short-circuits the render before this page is reached.
 */
export default async function CommandCenterPage() {
  const [
    tenant,
    kpis,
    priorities,
    observability,
    cost,
    resolver,
    platformHealth,
    actionStats,
    agenda,
    alerts,
    capabilities,
    contextSettingsResult,
    preferencesResult,
  ] = await Promise.all([
    getActiveTenantIdentity(),
    getPublicKpis(),
    getOperationalPriorities(),
    getObservabilitySnapshot(),
    getCostGovernanceSnapshot(),
    getResolverObservability(),
    getPlatformHealth(),
    getAgentActionStats(),
    getDashboardAgenda(),
    getUnifiedAlertsCached(),
    getCapabilitiesCached(),
    getDashboardContextSettingsCached(),
    getDashboardUserPreferences(),
  ]);

  const prefs = preferencesResult.ok
    ? preferencesResult.data
    : HERMES_DEFAULT_PREFERENCES;
  const reg = prefs.regional;
  const tenantSettings = contextSettingsResult.ok
    ? contextSettingsResult.data
    : DEFAULT_CONTEXT_SETTINGS;
  const settings = {
    ...tenantSettings,
    locale: reg.locale ?? tenantSettings.locale,
    country: reg.country ?? tenantSettings.country,
    currency: reg.currency ?? tenantSettings.currency,
  };
  const tz = resolveTimezone({
    userTimezone: reg.timezone,
    tenantTimezone: tenantSettings.timezone,
  });

  // Resolve the load-time active profile server-side (same rule as the chrome) purely to
  // read its context-bar segment config — the ContextBar shows the segments configured for
  // the profile the cockpit opens on.
  const globalLayout = clampLayout(prefs.layout);
  const profiles = clampProfiles(prefs.profiles);
  const capabilityKeys = new Set(
    capabilities.ok ? capabilities.data.capabilities.map((c) => c.actionKey) : [],
  );
  const capabilitiesKnown =
    capabilities.ok && capabilities.data.resolutionStatus === "OK";
  const offeredProfiles = availableProfiles(
    deriveCapabilityTokens(capabilityKeys),
    capabilitiesKnown,
  );
  const activeProfile = fallbackProfile(
    resolveHomeProfile(prefs.behavior, profiles, globalLayout),
    offeredProfiles,
  );
  const layout = effectiveProfileLayout(profiles, activeProfile, globalLayout);
  const contextConfig = resolveContextConfig(layout.context);
  const contextSegments = contextVisibleSegments(contextConfig);

  // Weather only when a real location is configured AND at least one weather-dependent
  // segment is shown — skipping it strictly REDUCES the external Open-Meteo calls.
  const units = resolveUnitPreferences(settings.locale, settings.country, {
    ...(reg.temperatureUnit ? { temperature: reg.temperatureUnit } : {}),
    ...(reg.windUnit ? { wind: reg.windUnit } : {}),
    ...(reg.hourCycle ? { hourCycle: reg.hourCycle } : {}),
  });
  const showSeconds = reg.showSeconds;
  const weatherResult =
    needsWeather(contextConfig) &&
    settings.latitude !== null &&
    settings.longitude !== null
      ? await getCurrentWeather(settings.latitude, settings.longitude, tz.timezone)
      : null;

  const costTodayUsd =
    cost.ok && cost.data.period?.day ? cost.data.period.day.exposureUsd : null;
  const costMonthUsd =
    cost.ok && cost.data.period?.month ? cost.data.period.month.exposureUsd : null;
  const budgetRemainingUsd =
    cost.ok && cost.data.period?.month ? cost.data.period.month.remainingUsd : null;

  const now = new Date();
  const alertCount = alerts.ok ? actionableAlertCount(alerts.data.alerts) : null;
  const nextEvent = agenda.ok
    ? nextEventForBar(agenda.data, now, settings.locale)
    : null;
  const contextBar = buildContextBarModel({
    settings,
    timezone: tz.timezone,
    timezoneSource: tz.source,
    units,
    showSeconds,
    weather: weatherResult && weatherResult.ok ? weatherResult.data : null,
    costTodayUsd,
    costMonthUsd,
    budgetRemainingUsd,
    alertCount,
    nextEvent,
  });
  const initialClock = formatClock(now, tz.timezone, settings.locale, {
    hour12: units.hourCycle === "12h",
    showSeconds,
  });

  return (
    <CommandCenter
      contextBar={contextBar}
      initialClock={initialClock}
      contextSegments={contextSegments}
      tenant={tenant}
      kpis={kpis}
      observability={observability}
      platformHealth={platformHealth}
      actionStats={actionStats}
      resolver={resolver}
      cost={cost}
      alerts={alerts}
      priorities={priorities}
      capabilities={capabilities}
      quickActions={prefs.behavior.quickActions}
      locale={settings.locale}
      timezone={tz.timezone}
      hour12={units.hourCycle === "12h"}
    />
  );
}
