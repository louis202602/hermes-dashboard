import type { DashboardPreferences } from "@/lib/dashboard/preferences";
import {
  availableProfiles,
  clampProfiles,
  deriveCapabilityTokens,
  fallbackProfile,
  type ProfileId,
  type ProfilesState,
} from "@/lib/dashboard/profiles";
import { photoGateKeys } from "@/lib/dashboard/photoAccess";
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
  /** PHOTO-P0 — la verticale Studio est-elle activée pour ce tenant ? Optionnel et
   *  faux par défaut, donc strictement sans effet tant qu'elle n'est pas activée. */
  photoModuleEnabled = false,
): {
  globalLayout: LayoutPreferences;
  profiles: ProfilesState;
  capabilityKeys: Set<string>;
  offeredProfiles: ProfileId[];
  activeProfile: ProfileId;
} {
  const globalLayout = clampLayout(prefs.layout);
  const profiles = clampProfiles(prefs.profiles);
  const realCapabilityKeys = new Set(
    capabilities.ok ? capabilities.data.capabilities.map((c) => c.actionKey) : [],
  );
  // Clés de PORTILLON = capacités réelles + éventuelle activation de la verticale
  // photo. La clé synthétique n'ouvre aucune exécution, seulement de l'affichage.
  const capabilityKeys = photoGateKeys(realCapabilityKeys, photoModuleEnabled);
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
