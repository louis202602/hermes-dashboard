import { redirect } from "next/navigation";

import DashboardShell from "@/components/dashboard/DashboardShell";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getDashboardProjects,
  getPublicKpis,
} from "@/services/hermes/dashboard";

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
  const [kpis, projects] = await Promise.all([
    getPublicKpis(),
    getDashboardProjects(),
  ]);

  return (
    <DashboardShell
      userEmail={user.email ?? ""}
      kpis={kpis}
      projects={projects}
    />
  );
}
