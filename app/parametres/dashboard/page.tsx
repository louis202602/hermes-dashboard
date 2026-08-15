import { redirect } from "next/navigation";

import DashboardSettings from "@/components/dashboard/DashboardSettings";
import { HERMES_DEFAULT_PREFERENCES } from "@/lib/dashboard/preferences";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getDashboardUserPreferences } from "@/services/hermes/preferences";

export const metadata = {
  title: "Paramètres · Dashboard — Hermès OS",
};

export default async function DashboardSettingsPage() {
  // Same server-side auth boundary as the dashboard.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const prefsResult = await getDashboardUserPreferences();
  const prefs = prefsResult.ok ? prefsResult.data : HERMES_DEFAULT_PREFERENCES;

  return (
    <main className="settings-shell">
      <DashboardSettings initial={prefs} />
    </main>
  );
}
