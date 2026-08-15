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
  // Weather only when a real location is configured — never fabricated. Cached
  // server-side (15 min) so it is not called per render.
  const weatherResult =
    settings.latitude !== null && settings.longitude !== null
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
    />
  );
}
