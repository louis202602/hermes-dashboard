import { cache } from "react";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUnifiedAlerts } from "@/services/hermes/agenda";
import { getDashboardContextSettings } from "@/services/hermes/contextBar";
import { getAvailableCapabilities } from "@/services/hermes/panels";
import { getPhotoModuleState } from "@/services/hermes/photo";

// PHASE-1 COST-FIRST — the shared dashboard chrome (route-group `layout.tsx`) and the
// Command Center page (`page.tsx`) render in the SAME request but are separate server
// modules, so Next.js cannot drill props between them. React `cache()` gives each of
// these reads request-scoped memoization: the layout and the page can both call them
// and the underlying RPC / GoTrue round-trip happens exactly ONCE per request.
//
// Only the genuinely cross-boundary reads live here (auth user, capabilities, alerts).
// `getDashboardUserPreferences` is already `cache()`-wrapped at its source, so it is
// deduped without an extra wrapper. Reads used by a single side (tenant, kpis, agenda,
// cost, …) are called directly there and need no memo.

/** The authenticated user (or null). Read by the chrome (email, redirect guard) and by
 *  the page (auth boundary) — memoized so GoTrue is hit once. */
export const getAuthedUser = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/** Granted capabilities. Chrome uses them for the offered profiles; the page uses them
 *  for Quick Actions + widget availability. One RPC per request. */
export const getCapabilitiesCached = cache(getAvailableCapabilities);

/** Unified alerts. Chrome derives the notification feed + the context-bar alert count;
 *  the page renders the critical alerts card. One RPC per request. */
export const getUnifiedAlertsCached = cache(getUnifiedAlerts);

/** Tenant context settings (defaults for locale/timezone/units). Chrome uses them for the
 *  i18n language + notification-locale fallback; the page uses them for the context bar.
 *  One RPC per request. */
export const getDashboardContextSettingsCached = cache(getDashboardContextSettings);

/** PHOTO-P0 — activation de la verticale Studio pour le tenant. Lecture minuscule
 *  (un booléen), `cache()`-partagée entre le chrome et la page : UNE seule RPC par
 *  requête. C'est le seul coût ajouté par la verticale aux tenants qui ne l'ont pas. */
export const getPhotoModuleStateCached = cache(getPhotoModuleState);
