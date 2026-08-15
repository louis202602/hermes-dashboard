"use client";

import maplibregl from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";

import "maplibre-gl/dist/maplibre-gl.css";

import { getChantierWeatherAction } from "@/app/actions/chantier-map";
import {
  MAP_FILTERS,
  MAP_FILTER_LABELS,
  MARKER_LABELS,
  computeMapView,
  deriveMarkerStatus,
  filterChantiers,
  markerStatusToken,
  routeUrl,
  type ChantierPoint,
  type MapFilter,
} from "@/lib/dashboard/chantierMap";

// Free, keyless OSM vector tiles (OpenFreeMap). Overridable via env for
// self-hosting (PMTiles / tileserver) without touching the app — future-proof, 0 €.
const STYLE_URL =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ||
  "https://tiles.openfreemap.org/styles/liberty";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("fr-FR");
}

export default function ChantierMap({ points }: { points: ChantierPoint[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [filter, setFilter] = useState<MapFilter>("all");
  const [failed, setFailed] = useState(false);
  const now = useMemo(() => new Date(), []);

  const shown = useMemo(
    () => filterChantiers(points, filter, now),
    [points, filter, now],
  );

  // Init map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const view = computeMapView(points);
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: STYLE_URL,
        center: view.center,
        zoom: view.zoom,
        attributionControl: { compact: true },
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.on("error", () => setFailed(true));
      mapRef.current = map;
    } catch {
      // Defer out of the synchronous effect body (init failure ⇒ show fallback).
      queueMicrotask(() => setFailed(true));
    }
    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (Re)build markers when the filtered set changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || failed) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    for (const p of shown) {
      const status = deriveMarkerStatus(p, now);
      const el = document.createElement("button");
      el.type = "button";
      el.className = `map-marker ${markerStatusToken(status)}`;
      el.setAttribute("aria-label", `${p.name} — ${MARKER_LABELS[status]}`);

      const popupNode = document.createElement("div");
      popupNode.className = "map-popup";
      const title = document.createElement("strong");
      title.className = "map-popup-title";
      title.textContent = p.name;
      const meta = document.createElement("div");
      meta.className = "map-popup-meta";
      meta.textContent = [
        MARKER_LABELS[status],
        p.typeChantier,
        p.formattedAddress || p.address,
      ]
        .filter(Boolean)
        .join(" · ");
      const dates = document.createElement("div");
      dates.className = "map-popup-meta";
      dates.textContent = `Du ${fmtDate(p.dateDebut)} au ${fmtDate(p.dateFin)}`;
      const weather = document.createElement("div");
      weather.className = "map-popup-weather";
      weather.textContent = "Météo…";
      const route = document.createElement("a");
      route.className = "map-popup-route";
      route.href = routeUrl(p.latitude, p.longitude);
      route.target = "_blank";
      route.rel = "noopener noreferrer";
      route.textContent = "Ouvrir l’itinéraire";
      popupNode.append(title, meta, dates, weather, route);

      const popup = new maplibregl.Popup({ offset: 18, closeButton: true }).setDOMContent(popupNode);
      let weatherLoaded = false;
      popup.on("open", () => {
        if (weatherLoaded) return;
        weatherLoaded = true;
        void getChantierWeatherAction(p.latitude, p.longitude).then((w) => {
          weather.textContent = w
            ? `${w.icon} ${Math.round(w.temperatureC)}°C · ${w.condition}` +
              (w.windKph !== null ? ` · ${Math.round(w.windKph)} km/h` : "")
            : "Météo indisponible";
        });
      });

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([p.longitude, p.latitude])
        .setPopup(popup)
        .addTo(map);
      markersRef.current.push(marker);
    }
  }, [shown, failed, now]);

  if (failed) {
    return (
      <div className="chantier-map-fallback" role="status">
        <strong>Carte indisponible</strong>
        <span>Le fond de carte n’a pas pu être chargé. La liste des chantiers reste accessible.</span>
      </div>
    );
  }

  return (
    <div className="chantier-map">
      <div className="chantier-map-filters" role="group" aria-label="Filtres carte">
        {MAP_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={`map-filter-btn${filter === f ? " is-active" : ""}`}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {MAP_FILTER_LABELS[f]}
          </button>
        ))}
      </div>
      <div ref={containerRef} className="chantier-map-canvas" />
    </div>
  );
}
