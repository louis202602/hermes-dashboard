import PvAgendaManager from "@/components/dashboard/PvAgendaManager";
import { requireRoute } from "@/lib/dashboard/routeGuard";
import { getPvAgenda } from "@/services/hermes/agenda";

export const metadata = { title: "Agenda photovoltaïque — Hermès" };

export default async function PvAgendaPage() {
  await requireRoute("/agenda");
  const agenda = await getPvAgenda();
  return <PvAgendaManager agenda={agenda} locale="fr-FR" />;
}
