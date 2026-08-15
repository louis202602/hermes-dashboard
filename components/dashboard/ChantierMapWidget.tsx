"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { getChantiersMapAction } from "@/app/actions/chantier-map";
import type { ChantierMapData } from "@/lib/dashboard/chantierMap";

// MapLibre (heavy, WebGL) loads ONLY when this widget renders — never on the normal
// dashboard bundle (the widget is opt-in / default-hidden).
const ChantierMap = dynamic(() => import("@/components/dashboard/ChantierMap"), {
  ssr: false,
  loading: () => <div className="chantier-map-loading">Chargement de la carte…</div>,
});

export default function ChantierMapWidget({
  initial,
}: {
  initial?: ChantierMapData;
}) {
  const [data, setData] = useState<ChantierMapData | null>(initial ?? null);
  const [loading, setLoading] = useState(!initial);

  useEffect(() => {
    if (initial) return; // server already provided the data (full map page)
    let alive = true;
    void getChantiersMapAction().then((d) => {
      if (!alive) return;
      setData(d);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [initial]);

  return (
    <section className="panel chantier-map-panel" aria-label="Carte des chantiers">
      <header className="panel-head">
        <div>
          <span className="panel-eyebrow">TERRAIN</span>
          <h3>Carte des chantiers</h3>
        </div>
      </header>

      {loading ? (
        <div className="chantier-map-loading">Chargement…</div>
      ) : !data || data.points.length === 0 ? (
        <div className="chantier-map-empty" role="status">
          <strong>Aucun chantier géolocalisé</strong>
          <span>
            Les chantiers avec une adresse géocodée apparaîtront ici. Aucune donnée
            fictive n’est affichée.
          </span>
        </div>
      ) : (
        <ChantierMap points={data.points} />
      )}
    </section>
  );
}
