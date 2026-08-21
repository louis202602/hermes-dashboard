import CostGovernance from "@/components/dashboard/CostGovernance";
import PageHeading from "@/components/dashboard/PageHeading";
import { requireAuthedUser } from "@/lib/dashboard/requestScope";
import { getCostGovernanceSnapshot } from "@/services/hermes/panels";

export const metadata = { title: "Facturation & Coûts IA — Hermès OS" };

/**
 * /facturation — coûts & gouvernance : exposition du jour / du mois, budget restant,
 * quotas et consommation (source SW23 réelle). Réutilise CostGovernance tel quel — aucune
 * donnée artificielle ; UNAVAILABLE honnête si la source n'est pas configurée.
 */
export default async function BillingPage() {
  await requireAuthedUser();
  const cost = await getCostGovernanceSnapshot();
  return (
    <div className="page-stack">
      <PageHeading titleKey="nav.billing" />
      <CostGovernance cost={cost} />
    </div>
  );
}
