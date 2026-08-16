"use client";

import { LayoutGrid } from "lucide-react";

import { PROFILE_IDS, type ProfileId } from "@/lib/dashboard/profiles";
import type { MessageKey } from "@/lib/i18n/languages";
import { useI18n } from "@/lib/i18n/I18nProvider";

/**
 * DASH-4D — quick, tactile dashboard-mode switcher. A wrapping chip row (not a tiny
 * dropdown) so it stays usable on touch/tablet and mirrors correctly under RTL. Each
 * profile can carry a custom name (custom profile); otherwise the localized label is
 * used. Switching is handled by the shell CLIENT-side (no refetch).
 */
export default function ProfileSwitcher({
  active,
  names,
  onSelect,
}: {
  active: ProfileId;
  names: Partial<Record<ProfileId, string | null>>;
  onSelect: (id: ProfileId) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="profile-switcher" role="group" aria-label={t("profile.switcher.aria")}>
      <span className="profile-switcher-label">
        <LayoutGrid size={15} strokeWidth={1.8} aria-hidden />
        {t("profile.switcher.label")}
      </span>
      <div className="profile-switcher-chips">
        {PROFILE_IDS.map((id) => {
          const label = names[id]?.trim() || t(`profile.${id}` as MessageKey);
          const isActive = id === active;
          return (
            <button
              key={id}
              type="button"
              className={`profile-chip${isActive ? " is-active" : ""}`}
              aria-pressed={isActive}
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
