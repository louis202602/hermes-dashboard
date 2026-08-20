"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";

import { saveDashboardPreferencesAction } from "@/app/actions/dashboard-preferences";
import EditableWidgetGrid from "@/components/dashboard/EditableWidgetGrid";
import {
  resolveWidgetLayout,
  type WidgetSize,
} from "@/lib/dashboard/widgets";

/**
 * LA GRILLE DE WIDGETS DU DASHBOARD — enfin branchée.
 *
 * `EditableWidgetGrid` existait depuis DASH-4C mais n'était rendue nulle part :
 * le catalogue de widgets était donc une déclaration sans effet. Les widgets
 * photo comme les widgets PV étaient enregistrés, ordonnables en théorie, et
 * invisibles en pratique. Ce composant ferme cet écart, sans rien réécrire :
 * il RÉUTILISE la grille, le catalogue, `resolveWidgetLayout`, la composition de
 * verticale et l'action de préférences déjà en place.
 *
 * AUCUNE GRILLE SPÉCIFIQUE PV. Les widgets solaires arrivent par le même chemin
 * que tous les autres : le module `solar.studies` les possède, la composition
 * les autorise, le catalogue les décrit. Un tenant photo n'en voit aucun — non
 * pas parce qu'un `if` les cache, mais parce qu'ils ne sont jamais dans
 * `available`.
 *
 * PERSISTANCE OPTIMISTE, HONNÊTE : l'affichage suit immédiatement le geste, et
 * l'écriture part derrière. Si elle échoue (conflit de version, réseau), on
 * REVIENT à l'état précédent plutôt que de laisser un écran qui ment.
 */
export default function DashboardWidgetBoard({
  available,
  initialLayout,
  version,
  slots,
}: {
  /** Widgets réellement autorisés — issus de `composition.widgets`. */
  available: string[];
  initialLayout: Record<string, unknown>;
  /** Version de préférences pour la concurrence optimiste. */
  version: number;
  /** Contenu de chaque widget, rendu côté serveur. */
  slots: Record<string, ReactNode>;
}) {
  const [layout, setLayout] = useState<Record<string, unknown>>(initialLayout);
  const [prefsVersion, setPrefsVersion] = useState(version);
  const availableSet = useMemo(() => new Set(available), [available]);

  const resolved = useMemo(
    () => resolveWidgetLayout(layout as never, availableSet),
    [layout, availableSet],
  );

  const persist = useCallback(
    async (next: Record<string, unknown>, previous: Record<string, unknown>) => {
      const result = await saveDashboardPreferencesAction({ layout: next }, prefsVersion);
      if (result.ok && typeof result.version === "number") {
        setPrefsVersion(result.version);
        return;
      }
      // Échec : on restaure. Un écran qui affiche un ordre non enregistré est
      // pire qu'un écran qui n'a pas bougé.
      setLayout(previous);
    },
    [prefsVersion],
  );

  const onReorder = useCallback(
    (orderedIds: string[]) => {
      const previous = layout;
      const next = { ...layout, order: orderedIds };
      setLayout(next);
      void persist(next, previous);
    },
    [layout, persist],
  );

  const onResize = useCallback(
    (id: string, size: WidgetSize) => {
      const previous = layout;
      const sizes = { ...((layout.sizes as Record<string, unknown>) ?? {}), [id]: size };
      const next = { ...layout, sizes };
      setLayout(next);
      void persist(next, previous);
    },
    [layout, persist],
  );

  const onHide = useCallback(
    (id: string) => {
      const previous = layout;
      const hidden = new Set(
        Array.isArray(layout.hidden) ? (layout.hidden as string[]) : [],
      );
      hidden.add(id);
      const next = { ...layout, hidden: [...hidden] };
      setLayout(next);
      void persist(next, previous);
    },
    [layout, persist],
  );

  // Seuls les widgets DISPONIBLES et pourvus d'un contenu sont rendus. Un widget
  // catalogué sans composant lié ne doit pas produire une carte vide.
  const items = resolved.items.filter(
    (i) => !i.hidden && i.available && slots[i.id] !== undefined,
  );
  if (items.length === 0) return null;

  return (
    <EditableWidgetGrid
      items={items}
      renderWidget={(id) => slots[id] ?? null}
      onReorder={onReorder}
      onResize={onResize}
      onHide={onHide}
    />
  );
}
