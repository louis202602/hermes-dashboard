"use client";

import { LayoutGrid } from "lucide-react";

import { PROFILE_IDS, profileDef, type ProfileId } from "@/lib/dashboard/profiles";
import type { MessageKey } from "@/lib/i18n/languages";
import { useI18n } from "@/lib/i18n/I18nProvider";

/**
 * DASH-4D — quick, tactile dashboard-mode switcher. A wrapping chip row (not a tiny
 * dropdown) so it stays usable on touch/tablet and mirrors correctly under RTL. Each
 * profile can carry a custom name (custom profile); otherwise the localized label is
 * used. Switching is handled by the shell CLIENT-side (no refetch).
 *
 * DASH-4I — only the profiles OFFERED to this tenant are shown (capability/vertical
 * filtered); the active chip is always shown even if transiently not in the list.
 */
export default function ProfileSwitcher({
  active,
  available,
  names,
  onSelect,
}: {
  active: ProfileId;
  available: ProfileId[];
  names: Partial<Record<ProfileId, string | null>>;
  onSelect: (id: ProfileId) => void;
}) {
  const { t } = useI18n();
  const shown = PROFILE_IDS.filter((id) => available.includes(id) || id === active);
  const photovoltaicFocus =
    shown.length === 1 && shown[0] === "direction" && available.length === 1;

  return (
    <div className="profile-switcher" role="group" aria-label={t("profile.switcher.aria")}>
      <span className="profile-switcher-label">
        <LayoutGrid size={15} strokeWidth={1.8} aria-hidden />
        {t("profile.switcher.label")}
      </span>
      <div className="profile-switcher-chips">
        {shown.map((id) => {
          const label = photovoltaicFocus
            ? "Photovoltaïque"
            : names[id]?.trim() || t(`profile.${id}` as MessageKey);
          const descKey = profileDef(id)?.descriptionKey;
          const isActive = id === active;
          return (
            <button
              key={id}
              type="button"
              className={`profile-chip${isActive ? " is-active" : ""}`}
              aria-pressed={isActive}
              title={photovoltaicFocus ? "Pilotage photovoltaïque" : descKey ? t(descKey as MessageKey) : undefined}
              onClick={() => onSelect(id)}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
