import "server-only";

import { cookies } from "next/headers";

import {
  HERMES_DEFAULT_APPEARANCE,
  HERMES_DEFAULT_BEHAVIOR,
  datasetToAppearance,
  parseAppearanceCookie,
  type Appearance,
  type Behavior,
} from "@/lib/dashboard/preferences";
import {
  clampProfiles,
  effectiveProfileAppearance,
  resolveActiveProfile,
} from "@/lib/dashboard/profiles";
import { clampLayout } from "@/lib/dashboard/widgets";
import { APPEARANCE_COOKIE_NAME } from "@/lib/theme";
import { getDashboardUserPreferences } from "@/services/hermes/preferences";

/**
 * DASH-4A — resolve the appearance to SSR onto `<html>` for the FIRST paint, so a
 * brand-new device (server prefs exist, no cookie yet) never flashes the default.
 *
 * Precedence:
 *   1. Authenticated user with a server row → the canonical DB appearance/behavior.
 *   2. Otherwise (anon route, or DB unavailable) → the appearance cookie (a returning
 *      visitor's cached choice), so the login screen still respects their theme.
 *   3. Otherwise → the Hermès default.
 *
 * COST-FIRST: the DB is queried ONLY when a Supabase auth cookie is present, and that
 * read is `cache()`-shared with the page/settings route (1 read per request). Anon
 * routes do zero DB work. `theme:"auto"` is carried through unchanged — the pre-paint
 * init script resolves it against the OS (the server cannot know it).
 */
export async function resolveInitialAppearance(): Promise<{
  appearance: Appearance;
  behavior: Behavior;
}> {
  const jar = await cookies();
  const hasSession = jar
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));

  if (hasSession) {
    const result = await getDashboardUserPreferences();
    if (result.ok) {
      // DASH-4D: stamp the ACTIVE profile's effective appearance (global appearance +
      // that profile's partial override) onto <html> at first paint — so a profile
      // theme/accent override has NO FOUC. Uses the same cache()-shared prefs read as
      // the page (0 extra DB). theme:"auto" is carried through unchanged.
      const profiles = clampProfiles(result.data.profiles);
      const activeProfile = resolveActiveProfile(
        profiles,
        clampLayout(result.data.layout),
      );
      return {
        appearance: effectiveProfileAppearance(
          result.data.appearance,
          profiles,
          activeProfile,
        ),
        behavior: result.data.behavior,
      };
    }
  }

  const cookie = jar.get(APPEARANCE_COOKIE_NAME);
  if (cookie?.value) {
    const ds = parseAppearanceCookie(decodeURIComponent(cookie.value));
    if (Object.keys(ds).length > 0) {
      return {
        appearance: datasetToAppearance(ds),
        behavior: HERMES_DEFAULT_BEHAVIOR,
      };
    }
  }

  return {
    appearance: HERMES_DEFAULT_APPEARANCE,
    behavior: HERMES_DEFAULT_BEHAVIOR,
  };
}
