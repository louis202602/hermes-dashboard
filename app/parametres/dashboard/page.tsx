import { redirect } from "next/navigation";

import DashboardSettings from "@/components/dashboard/DashboardSettings";
import { HERMES_DEFAULT_PREFERENCES } from "@/lib/dashboard/preferences";
import {
  PROFILE_IDS,
  availableProfiles,
  clampProfiles,
  deriveCapabilityTokens,
  profileWallpaperFields,
} from "@/lib/dashboard/profiles";
import { availableWidgetIds } from "@/lib/dashboard/widgets";
import { grantedModules } from "@/lib/verticals/modules";
import { isUserWallpaperRef, resolveWallpaper } from "@/lib/dashboard/wallpapers";
import { getCatalog, getLanguageDef, resolveLanguage } from "@/lib/i18n";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAvailableCapabilities } from "@/services/hermes/panels";
import { getDashboardUserPreferences } from "@/services/hermes/preferences";
import { signUserWallpapers } from "@/services/hermes/wallpapers";

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
  // DASH-4I: capability-first — derive functional tokens, then the offered profiles.
  const tokens = deriveCapabilityTokens(capabilityKeys);
  // PV-3 : la galerie doit refléter la MÊME disponibilité que le dashboard. Les
  // widgets gardés par un module exigent donc la liste des modules accordés ici
  // aussi — sinon un tenant photo verrait « Études à valider » proposée dans ses
  // réglages alors qu'il ne peut pas l'afficher.
  const available = [...availableWidgetIds(capabilityKeys, grantedModules(tokens))];
  const offeredProfiles = availableProfiles(
    tokens,
    capabilities.ok && capabilities.data.resolutionStatus === "OK",
  );
  // DASH-4E: sign each profile's user-uploaded wallpaper so the settings live preview can
  // paint it (built-in images resolve their /public asset client-side and need no URL).
  // COST-FIRST: one batched signer resolves the owner once; usually empty (CSS built-ins).
  const profiles = clampProfiles(prefs.profiles);
  const wallpaperEntries: { key: string; ref: string }[] = [];
  for (const id of PROFILE_IDS) {
    const ref = resolveWallpaper(profileWallpaperFields(profiles, id), profiles.wallpaper).ref;
    if (isUserWallpaperRef(ref)) wallpaperEntries.push({ key: id, ref: ref as string });
  }
  const wallpaperUrls = await signUserWallpapers(wallpaperEntries);
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
          availableProfiles={offeredProfiles}
          capabilities={capabilityList}
          wallpaperUrls={wallpaperUrls}
        />
      </main>
    </I18nProvider>
  );
}
