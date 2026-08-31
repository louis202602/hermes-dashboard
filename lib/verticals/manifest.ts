import type { ProfileId } from "@/lib/dashboard/profiles";
import type { ModuleId } from "@/lib/verticals/modules";

export const VERTICAL_IDS = [
  "photography",
  "real_estate",
  "solar",
  "construction",
  "generic",
] as const;
export type VerticalId = (typeof VERTICAL_IDS)[number];

const VERTICAL_SET = new Set<string>(VERTICAL_IDS);
export function isVerticalId(v: unknown): v is VerticalId {
  return typeof v === "string" && VERTICAL_SET.has(v);
}

export const DEFAULT_VERTICAL: VerticalId = "generic";

export type VerticalDef = {
  id: VerticalId;
  label: string;
  moduleOrder: ModuleId[];
  defaultProfile: ProfileId;
  signals: string[];
  integrationProviders: string[];
};

export const VERTICAL_MANIFEST: VerticalDef[] = [
  {
    id: "photography",
    label: "Studio photographe",
    moduleOrder: [
      "core.home",
      "crm.prospects",
      "crm.clients",
      "photo.sessions",
      "agenda",
      "photo.quotes",
      "photo.payments",
      "phone",
      "campaigns",
      "photo.gallery",
      "photo.portal",
      "photo.upsell",
      "photo.lifecycle",
      "core.integrations",
      "core.settings",
    ],
    defaultProfile: "photographe",
    signals: ["photo_studio"],
    integrationProviders: ["google_calendar", "gmail", "instagram", "meta", "qonto"],
  },
  {
    id: "real_estate",
    label: "Immobilier",
    moduleOrder: [
      "core.home",
      "crm.prospects",
      "immo.properties",
      "immo.sellers",
      "immo.buyers",
      "immo.viewings",
      "agenda",
      "phone",
      "campaigns",
      "core.integrations",
      "core.settings",
    ],
    defaultProfile: "immobilier",
    signals: ["properties"],
    integrationProviders: ["google_calendar", "gmail", "meta", "qonto"],
  },
  {
    id: "solar",
    label: "Solaire",
    moduleOrder: [
      "core.home",
      "crm.prospects",
      "solar.studies",
      "crm.clients",
      "worksites",
      "agenda",
      "phone",
      "documents",
      "core.billing",
      "core.integrations",
      "core.settings",
    ],
    defaultProfile: "direction",
    signals: ["worksites", "quotes"],
    integrationProviders: ["google_calendar", "gmail", "qonto"],
  },
  {
    id: "construction",
    label: "BTP / chantiers",
    moduleOrder: [
      "core.home",
      "crm.prospects",
      "worksites",
      "agenda",
      "documents",
      "core.billing",
      "core.integrations",
      "core.settings",
    ],
    defaultProfile: "chantier",
    signals: ["field_operations"],
    integrationProviders: ["google_calendar", "gmail", "qonto"],
  },
  {
    id: "generic",
    label: "Générique",
    moduleOrder: ["core.home", "crm.prospects", "crm.clients", "agenda", "core.integrations", "core.settings"],
    defaultProfile: "direction",
    signals: [],
    integrationProviders: ["google_calendar", "gmail", "qonto"],
  },
];

const VERTICAL_BY_ID = new Map<VerticalId, VerticalDef>(
  VERTICAL_MANIFEST.map((v) => [v.id, v]),
);

export function verticalDef(id: VerticalId): VerticalDef {
  return VERTICAL_BY_ID.get(id) ?? VERTICAL_BY_ID.get(DEFAULT_VERTICAL)!;
}

export function resolveVertical(
  capabilityTokens: Iterable<string>,
  declared?: string | null,
): { vertical: VerticalId; source: "DECLARED" | "DERIVED" | "DEFAULT" } {
  if (isVerticalId(declared)) return { vertical: declared, source: "DECLARED" };

  const tokens = capabilityTokens instanceof Set ? capabilityTokens : new Set(capabilityTokens);
  let best: VerticalDef | null = null;
  for (const v of VERTICAL_MANIFEST) {
    if (v.signals.length === 0) continue;
    if (!v.signals.every((s) => tokens.has(s))) continue;
    if (best === null || v.signals.length > best.signals.length) best = v;
  }
  return best
    ? { vertical: best.id, source: "DERIVED" }
    : { vertical: DEFAULT_VERTICAL, source: "DEFAULT" };
}

export function verticalIntegrationProviders(
  vertical: VerticalId,
  globallyEnabled: Iterable<string>,
): string[] {
  const enabled = globallyEnabled instanceof Set ? globallyEnabled : new Set(globallyEnabled);
  return verticalDef(vertical).integrationProviders.filter((p) => enabled.has(p));
}
