/**
 * Route access contract for the single Hermès platform.
 *
 * This is a *contract only*. Phase 1 does NOT enforce any of these levels and
 * does NOT simulate permissions or roles. Real enforcement (auth, session,
 * tenant scoping) is deferred to Phase 2, once Supabase auth exists.
 *
 * It exists so later phases can classify routes (e.g. via route groups) against
 * a shared, typed vocabulary instead of ad-hoc strings.
 */
export type RouteAccessLevel = "public" | "authenticated" | "admin";

/**
 * Default posture for the platform: the dashboard is intended to sit behind auth.
 * Not enforced in Phase 1 — used only as the documented default for later gating.
 */
export const DEFAULT_ROUTE_ACCESS: RouteAccessLevel = "authenticated";
