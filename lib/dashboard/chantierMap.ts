/**
 * CARTE-1 — Worksite map: pure, DOM-free contract. Parses the tenant-scoped facade
 * payload into typed points, derives a deterministic marker status from the real
 * business status + dates (no LLM), maps status → an Hermès token class (never a
 * hardcoded colour, never a hardcoded vertical), and filters points deterministically.
 * Shared by the server (parse) and the client (markers/filters). Unit-tested.
 */

export type MarkerStatus = "upcoming" | "running" | "done" | "late" | "alert";

export type ChantierPoint = {
  id: string;
  name: string;
  clientName: string | null;
  address: string | null;
  formattedAddress: string | null;
  status: string | null;
  typeChantier: string | null;
  dateDebut: string | null; // ISO date
  dateFin: string | null; // ISO date
  latitude: number;
  longitude: number;
  countryCode: string | null;
  timezone: string | null;
};

export type ChantierMapData = {
  resolutionStatus: string;
  tenantId: string | null;
  points: ChantierPoint[];
};

export const MARKER_STATUSES: MarkerStatus[] = [
  "upcoming",
  "running",
  "done",
  "late",
  "alert",
];

/** Hermès token class for a marker (status colours stay independent of the accent). */
export function markerStatusToken(status: MarkerStatus): string {
  return `marker-${status}`;
}

function isValidCoord(lat: unknown, lon: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lon === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180 &&
    !(lat === 0 && lon === 0)
  );
}

function toDateOrNull(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Deterministic marker status from the real business status + planned/real dates.
 * Priority: explicit alert/late/done keywords → then date-derived (upcoming/overdue)
 * → running. Never fabricated.
 */
export function deriveMarkerStatus(point: ChantierPoint, now: Date): MarkerStatus {
  const s = (point.status ?? "").toLowerCase();
  if (/alerte|alert|incident|bloqu/.test(s)) return "alert";
  const done = /termin|clos|done|complete|livr/.test(s);
  if (/retard|late|overdue/.test(s)) return "late";
  if (done) return "done";

  const today = startOfDay(now);
  const debut = toDateOrNull(point.dateDebut);
  const fin = toDateOrNull(point.dateFin);
  if (debut && startOfDay(debut) > today) return "upcoming";
  if (fin && startOfDay(fin) < today) return "late"; // past end date, not marked done
  return "running";
}

// --- Filters ----------------------------------------------------------------

export const MAP_FILTERS = [
  "all",
  "today",
  "week",
  "upcoming",
  "running",
  "done",
  "late",
  "alert",
] as const;
export type MapFilter = (typeof MAP_FILTERS)[number];

function spansDay(point: ChantierPoint, dayStart: number, dayEnd: number): boolean {
  const debut = toDateOrNull(point.dateDebut);
  const fin = toDateOrNull(point.dateFin);
  const s = debut ? startOfDay(debut) : null;
  const e = fin ? startOfDay(fin) : s;
  if (s === null) return false;
  const end = e ?? s;
  return s <= dayEnd && end >= dayStart;
}

/** Deterministic point filter (no LLM). `all` returns everything. */
export function filterChantiers(
  points: ChantierPoint[],
  filter: MapFilter,
  now: Date,
): ChantierPoint[] {
  if (filter === "all") return points;
  const today = startOfDay(now);
  if (filter === "today") {
    return points.filter((p) => spansDay(p, today, today));
  }
  if (filter === "week") {
    // ISO week: Monday→Sunday around `now` (UTC, deterministic).
    const dow = (new Date(today).getUTCDay() + 6) % 7; // 0 = Monday
    const weekStart = today - dow * 86400000;
    const weekEnd = weekStart + 6 * 86400000;
    return points.filter((p) => spansDay(p, weekStart, weekEnd));
  }
  return points.filter((p) => deriveMarkerStatus(p, now) === filter);
}

// --- Parse ------------------------------------------------------------------

export function parseChantiersMap(payload: unknown): ChantierMapData {
  const p = (payload ?? {}) as Record<string, unknown>;
  const status = String(p.resolution_status ?? "DEFAULT");
  const rawList = Array.isArray(p.chantiers) ? p.chantiers : [];
  const points: ChantierPoint[] = [];
  for (const raw of rawList) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const num = (v: unknown): number =>
      typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    const lat = num(r.latitude);
    const lon = num(r.longitude);
    if (!isValidCoord(lat, lon)) continue; // MAP_UNKNOWN_COORDS_IGNORED
    if (typeof r.id !== "string") continue;
    points.push({
      id: r.id,
      name: typeof r.chantier_name === "string" ? r.chantier_name : "Chantier",
      clientName: typeof r.client_name === "string" ? r.client_name : null,
      address: typeof r.adresse === "string" ? r.adresse : null,
      formattedAddress:
        typeof r.formatted_address === "string" ? r.formatted_address : null,
      status: typeof r.status === "string" ? r.status : null,
      typeChantier: typeof r.type_chantier === "string" ? r.type_chantier : null,
      dateDebut: typeof r.date_debut === "string" ? r.date_debut : null,
      dateFin: typeof r.date_fin === "string" ? r.date_fin : null,
      latitude: lat,
      longitude: lon,
      countryCode: typeof r.country_code === "string" ? r.country_code : null,
      timezone: typeof r.iana_timezone === "string" ? r.iana_timezone : null,
    });
  }
  return {
    resolutionStatus: status,
    tenantId: typeof p.tenant_id === "string" ? p.tenant_id : null,
    points,
  };
}

/** Center + zoom hint for the initial map view (deterministic; safe on empty). */
export function computeMapView(points: ChantierPoint[]): {
  center: [number, number];
  zoom: number;
} {
  if (points.length === 0) return { center: [2.3522, 48.8566], zoom: 4 }; // France-ish default
  const lats = points.map((p) => p.latitude);
  const lons = points.map((p) => p.longitude);
  const center: [number, number] = [
    (Math.min(...lons) + Math.max(...lons)) / 2,
    (Math.min(...lats) + Math.max(...lats)) / 2,
  ];
  const spread = Math.max(
    Math.max(...lats) - Math.min(...lats),
    Math.max(...lons) - Math.min(...lons),
  );
  const zoom = spread > 5 ? 4 : spread > 1 ? 7 : spread > 0.1 ? 10 : 12;
  return { center, zoom };
}

/** External navigation URL — no paid routing API, opens the device's map app. */
export function routeUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
}
