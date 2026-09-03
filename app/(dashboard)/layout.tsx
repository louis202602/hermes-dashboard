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
import { getDashboardTenants } from "@/services/hermes/tenants";
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
  const user = await requireAuthedUser();

  const [preferencesResult, capabilities, alerts, contextSettingsResult, photoModule, tenantList] =
    await Promise.all([
      getDashboardUserPreferences(),
      getCapabilitiesCached(),
      getUnifiedAlertsCached(),
      getDashboardContextSettingsCached(),
      getPhotoModuleStateCached(),
      getDashboardTenants(),
    ]);

  const prefs = preferencesResult.ok
    ? preferencesResult.data
    : HERMES_DEFAULT_PREFERENCES;
  const reg = prefs.regional;
  const tenantSettings = contextSettingsResult.ok
    ? contextSettingsResult.data
    : DEFAULT_CONTEXT_SETTINGS;

  const activeTenant = tenantList.tenants.find(
    (tenant) => tenant.tenantId === tenantList.activeTenantId,
  ) ?? tenantList.tenants[0] ?? null;

  const lang = resolveLanguage(reg.language, tenantSettings.locale);
  const dir = getLanguageDef(lang).dir;
  const messages = getCatalog(lang);
  const locale = reg.locale ?? tenantSettings.locale;

  const { profiles, offeredProfiles, activeProfile } = resolveHomeProfileContext(
    prefs,
    capabilities,
    photoModule.enabled,
  );

  const composition = resolveTenantComposition({
    capabilityKeys: photoGateKeys(
      capabilities.ok ? capabilities.data.capabilities.map((c) => c.actionKey) : [],
      photoModule.enabled,
    ),
    permissions:
      capabilities.ok && capabilities.data.resolutionStatus === "OK" ? ["tenant.member"] : [],
    declaredVertical: activeTenant?.vertical ?? null,
  });

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
        tenants={tenantList.tenants}
        activeTenantId={tenantList.activeTenantId ?? activeTenant?.tenantId ?? null}
      >
        {children}
      </DashboardChrome>
    </I18nProvider>
  );
}
