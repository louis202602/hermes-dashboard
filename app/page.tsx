import { redirect } from "next/navigation";

import DashboardShell from "@/components/dashboard/DashboardShell";
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
import {
  HERMES_DEFAULT_PREFERENCES,
} from "@/lib/dashboard/preferences";
import {
  availableWidgetIds,
  clampLayout,
  needsWeather,
  resolveContextConfig,
  resolveWidgetLayout,
} from "@/lib/dashboard/widgets";
import {
  PROFILE_IDS,
  clampProfiles,
  effectiveProfileLayout,
  profileWallpaperFields,
} from "@/lib/dashboard/profiles";
import { resolveHomeProfile } from "@/lib/dashboard/shortcuts";
import { isUserWallpaperRef, resolveWallpaper } from "@/lib/dashboard/wallpapers";
import { signUserWallpaper } from "@/services/hermes/wallpapers";
import { getCatalog, getLanguageDef, resolveLanguage } from "@/lib/i18n";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getDashboardAgenda, getUnifiedAlerts } from "@/services/hermes/agenda";
import { getRecentConversations } from "@/services/hermes/conversations";
import {
  getCurrentWeather,
  getDashboardContextSettings,
} from "@/services/hermes/contextBar";
import {
  getDashboardProjects,
  getPublicKpis,
} from "@/services/hermes/dashboard";
import {
  getActionAuditTrail,
  getAvailableCapabilities,
  getCostGovernanceSnapshot,
  getObservabilitySnapshot,
  getOperationalPriorities,
  getPlatformHealth,
  getResolverControl,
  getResolverObservability,
} from "@/services/hermes/panels";
import { getDashboardUserPreferences } from "@/services/hermes/preferences";
import { getWorksiteWeather } from "@/services/hermes/worksiteWeather";
import {
  getAgentActionStats,
  getDashboardCommercial,
} from "@/services/hermes/systemActivity";
import { getActiveTenantIdentity } from "@/services/hermes/tenantIdentity";

export default async function HomePage() {
  // Server-side auth boundary: unauthenticated users never reach the dashboard.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Real backend reads. Tenant authorization is enforced inside the RPCs.
  const [
    tenant,
    kpis,
    projects,
    conversations,
    capabilities,
    priorities,
    observability,
    cost,
    audit,
    resolver,
    resolverControl,
    contextSettingsResult,
    agenda,
    alerts,
    platformHealth,
    actionStats,
    commercial,
    preferencesResult,
  ] = await Promise.all([
    getActiveTenantIdentity(),
    getPublicKpis(),
    getDashboardProjects(),
    getRecentConversations(),
    getAvailableCapabilities(),
    getOperationalPriorities(),
    getObservabilitySnapshot(),
    getCostGovernanceSnapshot(),
    getActionAuditTrail(),
    getResolverObservability(),
    getResolverControl(),
    getDashboardContextSettings(),
    getDashboardAgenda(),
    getUnifiedAlerts(),
    getPlatformHealth(),
    getAgentActionStats(),
    getDashboardCommercial(),
    getDashboardUserPreferences(),
  ]);

  // --- DASH-1 context bar assembly (deterministic clock + cached weather) ---
  const tenantSettings = contextSettingsResult.ok
    ? contextSettingsResult.data
    : DEFAULT_CONTEXT_SETTINGS;
  // DASH-4A: user regional override layered on top of the DASH-1 tenant defaults
  // (kept SEPARATE from visual appearance). null override ⇒ inherit tenant.
  const prefs = preferencesResult.ok
    ? preferencesResult.data
    : HERMES_DEFAULT_PREFERENCES;
  const reg = prefs.regional;
  const settings = {
    ...tenantSettings,
    locale: reg.locale ?? tenantSettings.locale,
    country: reg.country ?? tenantSettings.country,
    currency: reg.currency ?? tenantSettings.currency,
  };
  // Timezone precedence: user override → tenant → UTC (DST-safe).
  const tz = resolveTimezone({
    userTimezone: reg.timezone,
    tenantTimezone: tenantSettings.timezone,
  });
  // DASH-4B: resolve the user's widget layout (order + show/hide, capability-filtered)
  // and the configurable context-bar segments — all from the SINGLE prefs read + the
  // capabilities snapshot already loaded above (0 extra DB calls).
  // DASH-4D: resolve the ACTIVE profile (user-scoped) and its effective layout. The
  // global layout column is the pre-4D base (and the custom-profile fallback). The
  // profile only SELECTS/orders existing widgets — the capability filter still applies.
  const globalLayout = clampLayout(prefs.layout);
  const profiles = clampProfiles(prefs.profiles);
  // DASH-4H: the opening screen — resume the last-used mode (openLastMode) or a fixed
  // default profile (user-scoped, multi-device via the prefs row).
  const activeProfile = resolveHomeProfile(prefs.behavior, profiles, globalLayout);
  const layout = effectiveProfileLayout(profiles, activeProfile, globalLayout);
  // DASH-4E: sign every profile's user-image wallpaper server-side (short-TTL signed
  // URL, ownership re-checked) so switching profiles shows the right fond instantly.
  // Built-in (CSS) wallpapers need no URL. A few internal storage calls; 0 external API.
  const wallpaperRefs = new Map<string, string>();
  for (const id of PROFILE_IDS) {
    const ref = resolveWallpaper(profileWallpaperFields(profiles, id), profiles.wallpaper).ref;
    if (isUserWallpaperRef(ref)) wallpaperRefs.set(id, ref as string);
  }
  const wallpaperUrls: Record<string, string> = {};
  await Promise.all(
    [...wallpaperRefs.entries()].map(async ([id, ref]) => {
      const url = await signUserWallpaper(ref);
      if (url) wallpaperUrls[id] = url;
    }),
  );
  const capabilityKeys = new Set(
    capabilities.ok
      ? capabilities.data.capabilities.map((c) => c.actionKey)
      : [],
  );
  const available = availableWidgetIds(capabilityKeys);
  // DASH-4G COST-FIRST: only fetch enriched worksite weather when a widget that
  // consumes it is actually visible in the active profile. If both the daily summary
  // and the recommended actions are hidden, we skip the geo read AND every Open-Meteo
  // call — no network cost for data nothing would display.
  const resolvedWidgets = resolveWidgetLayout(layout, available);
  const weatherWidgetsVisible = resolvedWidgets.items.some(
    (it) =>
      (it.id === "daily-summary" || it.id === "recommended-actions") &&
      it.available &&
      !it.hidden,
  );
  const worksiteWeather = weatherWidgetsVisible ? await getWorksiteWeather() : [];
  const contextConfig = resolveContextConfig(layout.context);
  // DASH i18n: active UI language from the canonical user preference (→ tenant → default).
  const lang = resolveLanguage(reg.language, tenantSettings.locale);
  const dir = getLanguageDef(lang).dir;
  // Resolve the active catalog server-side and pass it as data, so the client only
  // ever ships the ONE active language (never all catalogs).
  const messages = getCatalog(lang);
  // Weather only when a real location is configured AND at least one weather-
  // dependent segment (weather/temperature/rain/wind) is shown — never fabricated,
  // and skipping it when all are hidden strictly REDUCES the external Open-Meteo
  // calls (COST-FIRST). Cached server-side when fetched.
  const weatherResult =
    needsWeather(contextConfig) &&
    settings.latitude !== null &&
    settings.longitude !== null
      ? await getCurrentWeather(
          settings.latitude,
          settings.longitude,
          tz.timezone,
        )
      : null;
  // Units follow locale/country (override-ready); user regional overrides win.
  const units = resolveUnitPreferences(settings.locale, settings.country, {
    ...(reg.temperatureUnit ? { temperature: reg.temperatureUnit } : {}),
    ...(reg.windUnit ? { wind: reg.windUnit } : {}),
    ...(reg.hourCycle ? { hourCycle: reg.hourCycle } : {}),
  });
  const showSeconds = reg.showSeconds;
  // Cost: real SW23 day/month exposure + monthly budget remaining (USD source).
  const costTodayUsd =
    cost.ok && cost.data.period?.day ? cost.data.period.day.exposureUsd : null;
  const costMonthUsd =
    cost.ok && cost.data.period?.month
      ? cost.data.period.month.exposureUsd
      : null;
  const budgetRemainingUsd =
    cost.ok && cost.data.period?.month
      ? cost.data.period.month.remainingUsd
      : null;
  // DASH-2: ALERT_COUNT from the unified, deterministic alerts source (only
  // actionable severities); NEXT_EVENT from the real agenda (never fabricated).
  const now = new Date();
  const alertCount = alerts.ok
    ? actionableAlertCount(alerts.data.alerts)
    : null;
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
    <I18nProvider lang={lang} dir={dir} messages={messages}>
    <DashboardShell
      userEmail={user.email ?? ""}
      tenant={tenant}
      kpis={kpis}
      projects={projects}
      conversations={conversations}
      capabilities={capabilities}
      priorities={priorities}
      observability={observability}
      cost={cost}
      audit={audit}
      resolver={resolver}
      resolverControl={resolverControl}
      contextBar={contextBar}
      initialClock={initialClock}
      agenda={agenda}
      alerts={alerts}
      locale={settings.locale}
      platformHealth={platformHealth}
      actionStats={actionStats}
      commercial={commercial}
      timezone={tz.timezone}
      hour12={units.hourCycle === "12h"}
      appearance={prefs.appearance}
      behavior={prefs.behavior}
      preferencesVersion={prefs.version}
      globalLayout={globalLayout}
      availableWidgets={[...available]}
      profiles={profiles}
      activeProfile={activeProfile}
      wallpaperUrls={wallpaperUrls}
      worksiteWeather={worksiteWeather}
    />
    </I18nProvider>
  );
}
