import CommandCenter from "@/components/dashboard/CommandCenter";
import DashboardWidgetBoard from "@/components/dashboard/DashboardWidgetBoard";
import PvProspectingStats from "@/components/dashboard/PvProspectingStats";
import {
  PvBillsToVerifyWidget,
  PvProspectsWithoutSiteWidget,
  PvStudiesToValidateWidget,
} from "@/components/dashboard/PvWidgets";
import {
  DEFAULT_CONTEXT_SETTINGS,
  buildContextBarModel,
  formatClock,
  resolveTimezone,
  resolveUnitPreferences,
} from "@/lib/dashboard/contextBar";
import { resolveHomeProfileContext } from "@/lib/dashboard/homeProfile";
import { HERMES_DEFAULT_PREFERENCES } from "@/lib/dashboard/preferences";
import { effectiveProfileLayout } from "@/lib/dashboard/profiles";
import {
  getCapabilitiesCached,
  getDashboardContextSettingsCached,
  getPhotoModuleStateCached,
  requireAuthedUser,
} from "@/lib/dashboard/requestScope";
import {
  contextVisibleSegments,
  needsWeather,
  resolveContextConfig,
} from "@/lib/dashboard/widgets";
import { getCurrentWeather } from "@/services/hermes/contextBar";
import { getCostGovernanceSnapshot, getPlatformHealth } from "@/services/hermes/panels";
import { getDashboardUserPreferences } from "@/services/hermes/preferences";
import { resolvePageContext } from "@/lib/dashboard/pageContext";
import { getPvPilotSnapshot } from "@/services/hermes/pv";
import { getPvOutreachSnapshot } from "@/services/hermes/prospecting";
import { classifyPlatformHealth } from "@/lib/dashboard/systemActivity";
import { getActiveTenantIdentity } from "@/services/hermes/tenantIdentity";

export default async function CommandCenterPage() {
  await requireAuthedUser();

  const [
    tenant,
    cost,
    platformHealth,
    capabilities,
    contextSettingsResult,
    preferencesResult,
    photoModule,
    outreachSnapshot,
  ] = await Promise.all([
    getActiveTenantIdentity(),
    getCostGovernanceSnapshot(),
    getPlatformHealth(),
    getCapabilitiesCached(),
    getDashboardContextSettingsCached(),
    getDashboardUserPreferences(),
    getPhotoModuleStateCached(),
    getPvOutreachSnapshot(),
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

  const { globalLayout, profiles, activeProfile } = resolveHomeProfileContext(
    prefs,
    capabilities,
    photoModule.enabled,
  );
  const layout = effectiveProfileLayout(profiles, activeProfile, globalLayout);
  const contextConfig = resolveContextConfig(layout.context);
  const contextSegments = contextVisibleSegments(contextConfig).filter(
    (segment) => segment !== "alerts" && segment !== "nextEvent",
  );

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
  const heroStatus = classifyPlatformHealth(platformHealth).status;
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
    alertCount: null,
    nextEvent: null,
  });
  const initialClock = formatClock(now, tz.timezone, settings.locale, {
    hour12: units.hourCycle === "12h",
    showSeconds,
  });

  const pageContext = await resolvePageContext();
  const composedWidgets = pageContext.composition.widgets;
  const needsPvSnapshot = composedWidgets.some((id) => id.startsWith("pv-"));
  const pvSnapshot = needsPvSnapshot ? await getPvPilotSnapshot() : null;

  const widgetSlots = pvSnapshot
    ? {
        "pv-studies-to-validate": <PvStudiesToValidateWidget snapshot={pvSnapshot} />,
        "pv-bills-to-verify": <PvBillsToVerifyWidget snapshot={pvSnapshot} />,
        "pv-prospects-without-site": <PvProspectsWithoutSiteWidget snapshot={pvSnapshot} />,
      }
    : {};

  return (
    <>
      <CommandCenter
        contextBar={contextBar}
        initialClock={initialClock}
        contextSegments={contextSegments}
        tenant={tenant}
        heroStatus={heroStatus}
        capabilities={capabilities}
        quickActions={prefs.behavior.quickActions}
      />
      <PvProspectingStats snapshot={outreachSnapshot} />
      <DashboardWidgetBoard
        available={composedWidgets}
        initialLayout={prefs.layout}
        version={prefs.version}
        slots={widgetSlots}
      />
    </>
  );
}
