import PhotoNewSessionForm from "@/components/dashboard/PhotoNewSessionForm";
import PhotoSessionsPanel from "@/components/dashboard/PhotoSessionsPanel";
import PhotoTodayPanel from "@/components/dashboard/PhotoTodayPanel";
import { requireRoute } from "@/lib/dashboard/routeGuard";
import { getPhotoSessions, getPhotoToday } from "@/services/hermes/photo";

export const metadata = { title: "Séances — Hermès Studio" };

/**
 * /seances — le cœur de la verticale photographe.
 *
 * CAPABILITY-FIRST, sans exception : si la verticale n'est pas activée pour ce
 * tenant, la route n'existe pas (404). Ce n'est pas un masquage cosmétique — les
 * façades appelées ci-dessous refusent elles aussi (`MODULE_DISABLED`), donc même
 * un accès direct à l'URL ne révèle rien.
 */
export default async function PhotoSessionsPage() {
  // Même garde que le menu et que /chantiers/carte : une seule liste de modules.
  await requireRoute("/seances");

  const [today, sessions] = await Promise.all([getPhotoToday(), getPhotoSessions(50)]);

  return (
    <div className="page-stack">
      <PhotoTodayPanel today={today} />
      <PhotoNewSessionForm />
      <PhotoSessionsPanel sessions={sessions} />
    </div>
  );
}
