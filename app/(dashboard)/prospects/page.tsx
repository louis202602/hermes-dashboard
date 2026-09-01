import PvLeadInboxPanel from "@/components/dashboard/PvLeadInboxPanel";
import { requireRoute } from "@/lib/dashboard/routeGuard";
import { getPvDailyKpi, getPvLeadInbox } from "@/services/hermes/pvLead";
import type { PvLeadTemperature } from "@/types/pvLead";

export const metadata = { title: "Prospects photovoltaïques — Hermès" };

const TEMPERATURES = new Set<PvLeadTemperature>([
  "FROID",
  "TIEDE",
  "CHAUD",
  "TRES_PRIORITAIRE",
]);

const VIEWS = new Set([
  "QUALIFIED",
  "HIGH",
  "PROBABLE",
  "REPLIED",
  "INTERESTED",
  "MEETING_REQUEST",
  "NO_REPLY",
  "CALL_PENDING",
  "EMAIL_SEQUENCE_EXHAUSTED",
  "DO_NOT_CONTACT",
]);

export default async function PvProspectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRoute("/prospects");

  const params = await searchParams;
  const one = (value: string | string[] | undefined): string | null => {
    const raw = Array.isArray(value) ? value[0] : value;
    const cleaned = (raw ?? "").trim();
    return cleaned.length > 0 ? cleaned : null;
  };

  const search = one(params.q);
  const rawTemperature = one(params.temperature)?.toUpperCase() ?? null;
  const temperature =
    rawTemperature && TEMPERATURES.has(rawTemperature as PvLeadTemperature)
      ? (rawTemperature as PvLeadTemperature)
      : null;
  const rawCallback = one(params.rappel);
  const needsCallback = rawCallback === "1" ? true : rawCallback === "0" ? false : null;
  const rawView = one(params.vue)?.toUpperCase() ?? null;
  const view = rawView && VIEWS.has(rawView) ? rawView : null;

  const [inbox, dailyKpi] = await Promise.all([
    getPvLeadInbox({
      search,
      temperature,
      needsCallback,
      limit: 200,
    }),
    getPvDailyKpi(),
  ]);

  return (
    <PvLeadInboxPanel
      inbox={inbox}
      dailyKpi={dailyKpi}
      filters={{ search, temperature, needsCallback, view }}
    />
  );
}
