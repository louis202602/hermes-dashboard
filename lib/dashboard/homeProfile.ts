import type { DashboardPreferences } from "@/lib/dashboard/preferences";
import {
  availableProfiles,
  clampProfiles,
  deriveCapabilityTokens,
  fallbackProfile,
  type ProfileId,
  type ProfilesState,
} from "@/lib/dashboard/profiles";
import { resolveHomeProfile } from "@/lib/dashboard/shortcuts";
import { clampLayout, type LayoutPreferences } from "@/lib/dashboard/widgets";
import type { AvailableCapabilities, ServiceResult } from "@/types/hermes";

/**
 * Single source of truth for "which profiles this tenant is offered and which one the
 * dashboard opens on". Shared by the chrome layout (profile switcher) and the Command
 * Center page (context-bar segments) so they never resolve against different rules.
 * Pure; capability-first (fail-open when capabilities are unknown).
 */
export function resolveHomeProfileContext(
  prefs: DashboardPreferences,
  capabilities: ServiceResult<AvailableCapabilities>,
): {
  globalLayout: LayoutPreferences;
  profiles: ProfilesState;
  capabilityKeys: Set<string>;
  offeredProfiles: ProfileId[];
  activeProfile: ProfileId;
} {
  const globalLayout = clampLayout(prefs.layout);
  const profiles = clampProfiles(prefs.profiles);
  const capabilityKeys = new Set(
    capabilities.ok ? capabilities.data.capabilities.map((c) => c.actionKey) : [],
  );
  const capabilitiesKnown =
    capabilities.ok && capabilities.data.resolutionStatus === "OK";
  const offeredProfiles = availableProfiles(
    deriveCapabilityTokens(capabilityKeys),
    capabilitiesKnown,
  );
  const activeProfile = fallbackProfile(
    resolveHomeProfile(prefs.behavior, profiles, globalLayout),
    offeredProfiles,
  );
  return { globalLayout, profiles, capabilityKeys, offeredProfiles, activeProfile };
}
