import { redirect } from "next/navigation";

import DashboardShell from "@/components/dashboard/DashboardShell";
import {
  DEFAULT_CONTEXT_SETTINGS,
  buildContextBarModel,
  formatClock,
  resolveTimezone,
} from "@/lib/dashboard/contextBar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
  getResolverControl,
  getResolverObservability,
} from "@/services/hermes/panels";
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
  ]);

  // --- DASH-1 context bar assembly (deterministic clock + cached weather) ---
  const settings = contextSettingsResult.ok
    ? contextSettingsResult.data
    : DEFAULT_CONTEXT_SETTINGS;
  // Timezone precedence: user → tenant → UTC (no user tz source yet).
  const tz = resolveTimezone({
    userTimezone: null,
    tenantTimezone: settings.timezone,
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
  // Cost today: real SW23 day exposure (USD). Alerts: real operational counts.
  const costTodayUsd =
    cost.ok && cost.data.period?.day ? cost.data.period.day.exposureUsd : null;
  const alertCount = priorities.ok
    ? priorities.data.summary.pendingApprovals +
      priorities.data.summary.openIncidents +
      priorities.data.summary.toQualify +
      priorities.data.summary.late
    : null;
  const contextBar = buildContextBarModel({
    settings,
    timezone: tz.timezone,
    timezoneSource: tz.source,
    weather: weatherResult && weatherResult.ok ? weatherResult.data : null,
    costTodayUsd,
    alertCount,
    // Agenda source lands in DASH-2 — slot prepared, no fabricated event.
    nextEvent: null,
  });
  const initialClock = formatClock(new Date(), tz.timezone, settings.locale);

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
    />
  );
}
