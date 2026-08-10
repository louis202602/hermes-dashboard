import { redirect } from "next/navigation";

import DashboardShell from "@/components/dashboard/DashboardShell";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRecentConversations } from "@/services/hermes/conversations";
import {
  getDashboardProjects,
  getPublicKpis,
} from "@/services/hermes/dashboard";
import {
  getAvailableCapabilities,
  getOperationalPriorities,
  getPlatformHealth,
} from "@/services/hermes/panels";

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
  const [kpis, projects, conversations, capabilities, priorities, health] =
    await Promise.all([
      getPublicKpis(),
      getDashboardProjects(),
      getRecentConversations(),
      getAvailableCapabilities(),
      getOperationalPriorities(),
      getPlatformHealth(),
    ]);

  return (
    <DashboardShell
      userEmail={user.email ?? ""}
      kpis={kpis}
      projects={projects}
      conversations={conversations}
      capabilities={capabilities}
      priorities={priorities}
      health={health}
    />
  );
}
