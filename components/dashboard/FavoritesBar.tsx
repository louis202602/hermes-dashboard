"use client";

import { Map as MapIcon, MessageSquare, Settings, Star } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { resolveFavorites } from "@/lib/dashboard/shortcuts";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/locales/fr";

type Props = {
  favorites: string[];
  registryWidgetIds: string[];
  visibleWidgetIds: string[];
};

const NAV_ICON: Record<string, LucideIcon> = {
  map: MapIcon,
  chat: MessageSquare,
  settings: Settings,
};

/**
 * DASH-4H — the user's pinned favorites as a compact chip row. A widget favorite links
 * to its in-page anchor ONLY when that widget is currently visible (no dead buttons); a
 * nav favorite links to its real route/anchor. Nothing resolvable ⇒ renders nothing.
 */
export default function FavoritesBar({ favorites, registryWidgetIds, visibleWidgetIds }: Props) {
  const { t } = useI18n();
  const resolved = resolveFavorites(favorites, registryWidgetIds, visibleWidgetIds).filter(
    (f) => f.kind === "nav" || f.visible,
  );
  if (resolved.length === 0) return null;

  return (
    <nav className="favorites-bar" aria-label={t("favorites.title")}>
      <span className="favorites-bar-label" aria-hidden>
        <Star size={14} strokeWidth={1.9} />
      </span>
      {resolved.map((f) => {
        if (f.kind === "widget") {
          return (
            <a key={`w:${f.id}`} className="favorite-chip" href={`#widget-${f.id}`}>
              {t(`widget.${f.id}` as MessageKey)}
            </a>
          );
        }
        const Icon = NAV_ICON[f.id] ?? Star;
        return (
          <a key={`n:${f.id}`} className="favorite-chip is-nav" href={f.target}>
            <Icon size={13} strokeWidth={1.9} aria-hidden />
            {t(f.labelKey as MessageKey)}
          </a>
        );
      })}
    </nav>
  );
}
