import ActionAuditTrail from "@/components/dashboard/ActionAuditTrail";
import PageHeading from "@/components/dashboard/PageHeading";
import ResolverControlPanel from "@/components/dashboard/ResolverControlPanel";
import { requireAuthedUser } from "@/lib/dashboard/requestScope";
import { getActionAuditTrail, getResolverControl } from "@/services/hermes/panels";

export const metadata = { title: "Sécurité & Autonomie — Hermès OS" };

/**
 * /securite — sécurité & autonomie : contrôle opérateur du résolveur (kill-switch, budget,
 * circuit) + journal d'audit des actions. L'autorisation (tenant.admin) est appliquée
 * DANS chaque service/RPC (SECURITY DEFINER) et reflétée par l'état du panneau — jamais
 * de contrôle exposé sans droit.
 */
export default async function SecurityPage() {
  await requireAuthedUser();
  const [resolverControl, audit] = await Promise.all([
    getResolverControl(),
    getActionAuditTrail(),
  ]);
  return (
    <div className="page-stack">
      <PageHeading titleKey="nav.security" />
      <ResolverControlPanel control={resolverControl} />
      <ActionAuditTrail audit={audit} />
    </div>
  );
}
