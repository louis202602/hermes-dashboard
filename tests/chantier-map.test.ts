import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  MARKER_STATUSES,
  computeMapView,
  deriveMarkerStatus,
  filterChantiers,
  markerStatusToken,
  parseChantiersMap,
  routeUrl,
  type ChantierPoint,
} from "../lib/dashboard/chantierMap.ts";

const NOW = new Date("2026-08-15T12:00:00Z");

function pt(over: Partial<ChantierPoint>): ChantierPoint {
  return {
    id: "x",
    name: "Chantier X",
    clientName: null,
    address: null,
    formattedAddress: null,
    status: null,
    typeChantier: null,
    dateDebut: null,
    dateFin: null,
    latitude: 43.3,
    longitude: 5.4,
    countryCode: "FR",
    timezone: null,
    ...over,
  };
}

// --- MAP_EMPTY --------------------------------------------------------------
test("MAP_EMPTY: empty / unauth payload ⇒ no points, honest status", () => {
  const d = parseChantiersMap({ resolution_status: "UNAUTHENTICATED", chantiers: [] });
  assert.equal(d.resolutionStatus, "UNAUTHENTICATED");
  assert.deepEqual(d.points, []);
  const view = computeMapView([]);
  assert.equal(view.zoom, 4); // safe default, no crash
});

// --- MAP_WITH_CHANTIERS + MAP_UNKNOWN_COORDS_IGNORED ------------------------
test("MAP_WITH_CHANTIERS: valid rows parsed, invalid coords dropped", () => {
  const d = parseChantiersMap({
    resolution_status: "OK",
    tenant_id: "heliosolar",
    chantiers: [
      { id: "a", chantier_name: "A", latitude: 43.3, longitude: 5.4, status: "en cours" },
      { id: "b", chantier_name: "B", latitude: null, longitude: 5.4 }, // no coords → ignored
      { id: "c", chantier_name: "C", latitude: 0, longitude: 0 }, // null island → ignored
      { chantier_name: "D", latitude: 1, longitude: 1 }, // no id → ignored
    ],
  });
  assert.equal(d.points.length, 1);
  assert.equal(d.points[0].id, "a");
});

// --- MARKER_* ---------------------------------------------------------------
test("MARKER status derivation is deterministic", () => {
  assert.equal(deriveMarkerStatus(pt({ status: "Alerte incident" }), NOW), "alert");
  assert.equal(deriveMarkerStatus(pt({ status: "Terminé" }), NOW), "done");
  assert.equal(deriveMarkerStatus(pt({ status: "En retard" }), NOW), "late");
  // future start ⇒ upcoming
  assert.equal(deriveMarkerStatus(pt({ dateDebut: "2026-09-01" }), NOW), "upcoming");
  // past end, not done ⇒ late (overdue)
  assert.equal(deriveMarkerStatus(pt({ dateDebut: "2026-07-01", dateFin: "2026-08-01" }), NOW), "late");
  // in-window, no keyword ⇒ running
  assert.equal(deriveMarkerStatus(pt({ dateDebut: "2026-08-01", dateFin: "2026-08-31" }), NOW), "running");
  // token mapping present for every status
  for (const s of MARKER_STATUSES) assert.match(markerStatusToken(s), /^marker-/);
});

// --- FILTERS ----------------------------------------------------------------
test("FILTER_TODAY / FILTER_WEEK / FILTER_RUNNING are deterministic", () => {
  const points = [
    pt({ id: "today", dateDebut: "2026-08-15", dateFin: "2026-08-15" }),
    pt({ id: "thisweek", dateDebut: "2026-08-11", dateFin: "2026-08-12" }), // Tue-Wed of that week
    pt({ id: "running", status: "en cours", dateDebut: "2026-08-01", dateFin: "2026-08-31" }),
    pt({ id: "next", dateDebut: "2026-09-10", dateFin: "2026-09-20" }),
  ];
  assert.deepEqual(
    filterChantiers(points, "today", NOW).map((p) => p.id),
    ["today", "running"], // both span 2026-08-15
  );
  const week = filterChantiers(points, "week", NOW).map((p) => p.id);
  assert.ok(week.includes("today"));
  assert.ok(week.includes("thisweek"));
  assert.ok(!week.includes("next"));
  const running = filterChantiers(points, "running", NOW).map((p) => p.id);
  assert.ok(running.includes("running"));
  assert.ok(!running.includes("next"));
  // all returns everything
  assert.equal(filterChantiers(points, "all", NOW).length, points.length);
});

// --- EXTERNAL_ROUTE_LINK ----------------------------------------------------
test("routeUrl builds an external navigation link (no paid API)", () => {
  const u = routeUrl(43.3, 5.4);
  assert.match(u, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=43\.3,5\.4$/);
});

// --- pure module: no network / no LLM ---------------------------------------
test("chantierMap module is pure: no fetch / network / LLM", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../lib/dashboard/chantierMap.ts", import.meta.url)),
    "utf8",
  );
  assert.doesNotMatch(src, /\bfetch\s*\(/);
  assert.doesNotMatch(src, /openai|anthropic|nominatim/i);
});

// --- CSS contract: map surface present --------------------------------------
test("CSS: worksite map classes present", () => {
  const css = readFileSync(
    fileURLToPath(new URL("../app/globals.css", import.meta.url)),
    "utf8",
  );
  assert.match(css, /\.chantier-map-canvas/);
  assert.match(css, /\.map-marker\.marker-alert/);
  assert.match(css, /\.map-filter-btn/);
});
