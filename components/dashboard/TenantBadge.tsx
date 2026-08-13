import { tenantInitials, tenantLabel } from "@/lib/tenant/identity";
import type { ServiceResult, TenantIdentity } from "@/types/hermes";

/**
 * Discreet, premium identity chip for the ACTIVE tenant (company). Shows the
 * tenant logo when configured, otherwise its initials — never a hardcoded client
 * brand, never a forced white background (a transparent logo keeps its own
 * transparency). Renders nothing when the tenant can't be resolved (honest: the
 * Command Center then reads as the generic product surface).
 *
 * This is the CLIENT brand; Hermès OS (sidebar / favicon logo V3) is separate.
 */
export default function TenantBadge({
  identity,
}: {
  identity: ServiceResult<TenantIdentity>;
}) {
  if (!identity.ok || identity.data.resolutionStatus !== "OK") return null;

  const label = tenantLabel(identity.data);
  if (!label) return null;

  const logoUrl = identity.data.logoUrl;

  return (
    <span className="tenant-badge" title={label} data-testid="tenant-badge">
      <span className="tenant-badge-mark">
        {logoUrl ? (
          // Local <img>: an arbitrary tenant logo URL, sized by CSS (contain).
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" />
        ) : (
          <span className="tenant-badge-initials" aria-hidden="true">
            {tenantInitials(label)}
          </span>
        )}
      </span>
      <span className="tenant-badge-name">{label}</span>
    </span>
  );
}
