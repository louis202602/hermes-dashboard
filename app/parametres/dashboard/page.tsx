import { redirect } from "next/navigation";

import DashboardSettings from "@/components/dashboard/DashboardSettings";
import { HERMES_DEFAULT_PREFERENCES } from "@/lib/dashboard/preferences";
import { availableWidgetIds } from "@/lib/dashboard/widgets";
import { getCatalog, getLanguageDef, resolveLanguage } from "@/lib/i18n";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAvailableCapabilities } from "@/services/hermes/panels";
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

  // Preferences + capabilities (the latter only to badge widget availability in
  // the gallery — canonical capabilities source, never a hardcoded vertical).
  const [prefsResult, capabilities] = await Promise.all([
    getDashboardUserPreferences(),
    getAvailableCapabilities(),
  ]);
  const prefs = prefsResult.ok ? prefsResult.data : HERMES_DEFAULT_PREFERENCES;
  const capabilityKeys = new Set(
    capabilities.ok
      ? capabilities.data.capabilities.map((c) => c.actionKey)
      : [],
  );
  const available = [...availableWidgetIds(capabilityKeys)];
  // DASH-4H: the granted capabilities (canonical) offered in the Quick-Actions picker.
  const capabilityList =
    capabilities.ok && capabilities.data.resolutionStatus === "OK"
      ? capabilities.data.capabilities.map((c) => ({ actionKey: c.actionKey, label: c.displayName }))
      : [];
  const lang = resolveLanguage(prefs.regional.language, prefs.regional.locale);
  const dir = getLanguageDef(lang).dir;
  const messages = getCatalog(lang);

  return (
    <I18nProvider lang={lang} dir={dir} messages={messages}>
      <main className="settings-shell" dir={dir}>
        <DashboardSettings
          initial={prefs}
          availableWidgets={available}
          capabilities={capabilityList}
        />
      </main>
    </I18nProvider>
  );
}
