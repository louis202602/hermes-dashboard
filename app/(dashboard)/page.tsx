import CommandCenter from "@/components/dashboard/CommandCenter";
import DashboardWidgetBoard from "@/components/dashboard/DashboardWidgetBoard";
import {
  PvBillsToVerifyWidget,
  PvProspectsWithoutSiteWidget,
  PvStudiesToValidateWidget,
} from "@/components/dashboard/PvWidgets";
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
import { resolveHomeProfileContext } from "@/lib/dashboard/homeProfile";
import { HERMES_DEFAULT_PREFERENCES } from "@/lib/dashboard/preferences";
import { effectiveProfileLayout } from "@/lib/dashboard/profiles";
import {
  getCapabilitiesCached,
  getDashboardContextSettingsCached,
  getPhotoModuleStateCached,
  getUnifiedAlertsCached,
  requireAuthedUser,
} from "@/lib/dashboard/requestScope";
import {
  contextVisibleSegments,
  needsWeather,
  resolveContextConfig,
} from "@/lib/dashboard/widgets";
import { getDashboardAgenda } from "@/services/hermes/agenda";
import { getCurrentWeather } from "@/services/hermes/contextBar";
import { getPublicKpis } from "@/services/hermes/dashboard";
import {
  getCostGovernanceSnapshot,
  getOperationalPriorities,
  getPlatformHealth,
} from "@/services/hermes/panels";
import { getDashboardUserPreferences } from "@/services/hermes/preferences";
import { resolvePageContext } from "@/lib/dashboard/pageContext";
import { getPvPilotSnapshot } from "@/services/hermes/pv";
import { classifyPlatformHealth } from "@/lib/dashboard/systemActivity";
import { getActiveTenantIdentity } from "@/services/hermes/tenantIdentity";

/**
 * Command Center Home (route `/`, inside the (dashboard) group). The chrome is provided
 * by the group layout; this page fetches ONLY the content snapshots and renders the épuré
 * PREMIUM cockpit — 4 light zones (context · hero command post · synthesis counters ·
 * quick chips), no full lists or heavy panels. Compared to the earlier Home it drops the
 * observability/action-stats/resolver reads (detail now lives in the /agents, /activite, …
 * sub-pages) and keeps only a light platform-health read for the hero état — so it loads
 * strictly LESS.
 *
 * AUTH: Next renders the group layout and this page CONCURRENTLY, so the layout's
 * redirect cannot stop the fan-out below — this page resolves the boundary itself,
 * first. Server-side enforcement in every RPC (SECURITY DEFINER) remains the security
 * guarantee; the guard here is what keeps a logged-out request from issuing them at all.
 */
export default async function CommandCenterPage() {
  await requireAuthedUser();

  const [
    tenant,
    kpis,
    priorities,
    cost,
    platformHealth,
    agenda,
    alerts,
    capabilities,
    contextSettingsResult,
    preferencesResult,
    photoModule,
  ] = await Promise.all([
    getActiveTenantIdentity(),
    getPublicKpis(),
    getOperationalPriorities(),
    getCostGovernanceSnapshot(),
    getPlatformHealth(),
    getDashboardAgenda(),
    getUnifiedAlertsCached(),
    getCapabilitiesCached(),
    getDashboardContextSettingsCached(),
    getDashboardUserPreferences(),
    getPhotoModuleStateCached(),
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

  // Resolve the load-time active profile server-side (SAME rule as the chrome, via the
  // shared helper) purely to read its context-bar segment config — the ContextBar shows
  // the segments configured for the profile the cockpit opens on.
  const { globalLayout, profiles, activeProfile } = resolveHomeProfileContext(
    prefs,
    capabilities,
    photoModule.enabled,
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
  // Honest severity for the synthesis tile: red only when a real critical alert exists,
  // amber for other actionable alerts, neutral when none. (Not "critical for any alert".)
  const alertTone: "critical" | "warning" | "none" =
    alerts.ok && alerts.data.summary.critical > 0
      ? "critical"
      : alertCount && alertCount > 0
        ? "warning"
        : "none";
  // Real Hermès/platform état for the hero pill — never a fabricated green "operational".
  const heroStatus = classifyPlatformHealth(platformHealth).status;
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

  // PV-4 — LA GRILLE DE WIDGETS, enfin branchée.
  //
  // `EditableWidgetGrid` existait depuis DASH-4C mais n'était rendue nulle part :
  // le catalogue de widgets était une déclaration sans effet. On la branche ici,
  // sous le cockpit, en réutilisant la composition de verticale — donc SANS
  // grille spécifique à un métier.
  //
  // COÛT : la composition est déjà calculée par `resolvePageContext` (mise en
  // cache par requête), et l'instantané PV n'est lu QUE si le tenant possède
  // réellement un widget solaire. Un tenant photo ne déclenche aucune lecture PV.
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
        alertCount={alertCount}
        alertTone={alertTone}
        priorities={priorities}
        kpis={kpis}
        capabilities={capabilities}
        quickActions={prefs.behavior.quickActions}
      />
      <DashboardWidgetBoard
        available={composedWidgets}
        initialLayout={prefs.layout}
        version={prefs.version}
        slots={widgetSlots}
      />
    </>
  );
}
