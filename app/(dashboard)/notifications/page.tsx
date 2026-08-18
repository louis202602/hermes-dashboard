import NotificationsView from "@/components/dashboard/NotificationsView";
import PageHeading from "@/components/dashboard/PageHeading";

export const metadata = { title: "Notifications — Hermès OS" };

/**
 * /notifications — la liste détaillée : sévérité, catégorie, lu/non-lu, filtres. Réutilise
 * le MÊME curseur de notifications que la cloche du header (partagé par le chrome via
 * contexte) — 0 lecture DB sur cette page, 0 polling, aucune divergence d'état.
 */
export default function NotificationsPage() {
  return (
    <div className="page-stack">
      <PageHeading titleKey="header.notifications" />
      <NotificationsView />
    </div>
  );
}
