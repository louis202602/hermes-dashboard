import NotificationsView from "@/components/dashboard/NotificationsView";
import PageHeading from "@/components/dashboard/PageHeading";
import { resolvePageContext } from "@/lib/dashboard/pageContext";
import { getUnifiedAlertsCached } from "@/lib/dashboard/requestScope";

export const metadata = { title: "Notifications — Hermès OS" };

/**
 * /notifications — la liste détaillée : sévérité, catégorie, lu/non-lu, filtres. Réutilise
 * le MÊME système de notifications que la cloche du header (dérivé de l'instantané alerts
 * déjà chargé, 0 lecture DB en plus, 0 polling) via le hook partagé et NotificationCenter
 * en variante « page ». La cloche du header continue de fonctionner indépendamment.
 */
export default async function NotificationsPage() {
  const [ctx, alerts] = await Promise.all([
    resolvePageContext(),
    getUnifiedAlertsCached(),
  ]);
  return (
    <div className="page-stack">
      <PageHeading titleKey="header.notifications" />
      <NotificationsView
        alerts={alerts}
        behavior={ctx.prefs.behavior}
        preferencesVersion={ctx.prefs.version}
        locale={ctx.locale}
      />
    </div>
  );
}
