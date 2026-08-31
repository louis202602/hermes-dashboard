import PvBillingPanel from "@/components/dashboard/PvBillingPanel";
import { requireRoute } from "@/lib/dashboard/routeGuard";
import { getPvBillingSnapshot } from "@/services/hermes/pvBilling";

export const metadata = { title: "Facturation photovoltaïque — Hermès" };

export default async function BillingPage() {
  await requireRoute("/facturation");
  const snapshot = await getPvBillingSnapshot();
  return <PvBillingPanel snapshot={snapshot} />;
}
