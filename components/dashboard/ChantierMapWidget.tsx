"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { getChantiersMapAction } from "@/app/actions/chantier-map";
import type { ChantierMapData } from "@/lib/dashboard/chantierMap";
import { useI18n } from "@/lib/i18n/I18nProvider";

// MapLibre (heavy, WebGL) loads ONLY when this widget renders — never on the normal
// dashboard bundle (the widget is opt-in / default-hidden).
const ChantierMap = dynamic(() => import("@/components/dashboard/ChantierMap"), {
  ssr: false,
});

export default function ChantierMapWidget({
  initial,
}: {
  initial?: ChantierMapData;
}) {
  const { t } = useI18n();
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
    <section className="panel chantier-map-panel" aria-label={t("map.title")}>
      <header className="panel-head">
        <div>
          <span className="panel-eyebrow">{t("map.eyebrow")}</span>
          <h3>{t("map.title")}</h3>
        </div>
      </header>

      {loading ? (
        <div className="chantier-map-loading">{t("common.loading")}</div>
      ) : !data || data.points.length === 0 ? (
        <div className="chantier-map-empty" role="status">
          <strong>{t("map.empty.title")}</strong>
          <span>{t("map.empty.body")}</span>
        </div>
      ) : (
        <ChantierMap points={data.points} />
      )}
    </section>
  );
}
