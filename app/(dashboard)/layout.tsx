import DashboardChrome from "@/components/dashboard/DashboardChrome";
import {
  DEFAULT_CONTEXT_SETTINGS,
} from "@/lib/dashboard/contextBar";
import { resolveHomeProfileContext } from "@/lib/dashboard/homeProfile";
import { HERMES_DEFAULT_PREFERENCES } from "@/lib/dashboard/preferences";
import {
  PROFILE_IDS,
  profileWallpaperFields,
} from "@/lib/dashboard/profiles";
import {
  getCapabilitiesCached,
  getDashboardContextSettingsCached,
  getPhotoModuleStateCached,
  getUnifiedAlertsCached,
  requireAuthedUser,
} from "@/lib/dashboard/requestScope";
import { isUserWallpaperRef, resolveWallpaper } from "@/lib/dashboard/wallpapers";
import { photoGateKeys } from "@/lib/dashboard/photoAccess";
import { resolveTenantComposition } from "@/lib/verticals/composition";
import { getCatalog, getLanguageDef, resolveLanguage } from "@/lib/i18n";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { getDashboardUserPreferences } from "@/services/hermes/preferences";
import { signUserWallpapers } from "@/services/hermes/wallpapers";

/**
 * The (dashboard) route-group layout — the SINGLE shared chrome for the Command Center
 * and every future métier page. It resolves the auth boundary, the active language and
 * the chrome-scoped snapshots ONCE, then mounts `<DashboardChrome>` around the page's
 * `children`. Pages inside the group render only their own content; the chrome is never
 * copied per page. COST-FIRST: every read here is `cache()`-shared with the page in the
 * same request (see `lib/dashboard/requestScope.ts`), so it costs no extra round-trip.
 */
export default async function DashboardGroupLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Auth boundary. NOTE: Next renders this layout and the page CONCURRENTLY, so this
  // redirect does not by itself stop a page's reads — every page that fans out data
  // resolves the same guard itself (directly or via `resolvePageContext`).
  const user = await requireAuthedUser();

  // Chrome-scoped reads (all cache()-shared with the page).
  const [preferencesResult, capabilities, alerts, contextSettingsResult, photoModule] =
    await Promise.all([
      getDashboardUserPreferences(),
      getCapabilitiesCached(),
      getUnifiedAlertsCached(),
      getDashboardContextSettingsCached(),
      getPhotoModuleStateCached(),
    ]);

  const prefs = preferencesResult.ok
    ? preferencesResult.data
    : HERMES_DEFAULT_PREFERENCES;
  const reg = prefs.regional;
  const tenantSettings = contextSettingsResult.ok
    ? contextSettingsResult.data
    : DEFAULT_CONTEXT_SETTINGS;

  // i18n: active UI language (user → tenant → default) resolved server-side; only the ONE
  // active catalog is shipped to the client.
  const lang = resolveLanguage(reg.language, tenantSettings.locale);
  const dir = getLanguageDef(lang).dir;
  const messages = getCatalog(lang);
  // BCP-47 locale for the notification timestamps in the header bell.
  const locale = reg.locale ?? tenantSettings.locale;

  // DASH-4D/4H/4I: profiles state, the profiles OFFERED to this tenant (capability-first),
  // and the opening profile — resolved by the shared helper (identical to the page).
  const { profiles, offeredProfiles, activeProfile } = resolveHomeProfileContext(
    prefs,
    capabilities,
    photoModule.enabled,
  );

  // LE MENU. Composé à partir des MÊMES clés de capacité que les widgets et la
  // garde de route — aucune lecture supplémentaire n'est faite ici. La sidebar
  // ne décide plus de rien : elle rend cette liste.
  const composition = resolveTenantComposition({
    capabilityKeys: photoGateKeys(
      capabilities.ok ? capabilities.data.capabilities.map((c) => c.actionKey) : [],
      photoModule.enabled,
    ),
    permissions:
      capabilities.ok && capabilities.data.resolutionStatus === "OK" ? ["tenant.member"] : [],
  });

  // DASH-4E: sign each profile's user-image wallpaper server-side (short-TTL signed URL,
  // ownership re-checked) so switching profiles paints the right fond instantly. Built-in
  // (CSS) wallpapers need no URL; one batched signer resolves the owner once (usually 0
  // storage calls because most profiles use CSS built-ins).
  const wallpaperEntries: { key: string; ref: string }[] = [];
  for (const id of PROFILE_IDS) {
    const ref = resolveWallpaper(
      profileWallpaperFields(profiles, id),
      profiles.wallpaper,
    ).ref;
    if (isUserWallpaperRef(ref)) wallpaperEntries.push({ key: id, ref: ref as string });
  }
  const wallpaperUrls = await signUserWallpapers(wallpaperEntries);

  return (
    <I18nProvider lang={lang} dir={dir} messages={messages}>
      <DashboardChrome
        userEmail={user.email ?? ""}
        appearance={prefs.appearance}
        behavior={prefs.behavior}
        preferencesVersion={prefs.version}
        locale={locale}
        profiles={profiles}
        activeProfile={activeProfile}
        availableProfiles={offeredProfiles}
        wallpaperUrls={wallpaperUrls}
        alerts={alerts}
        navigation={composition.navigation}
      >
        {children}
      </DashboardChrome>
    </I18nProvider>
  );
}
