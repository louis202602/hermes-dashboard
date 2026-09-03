"use client";

import { Building2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { setActiveTenantAction } from "@/app/actions/tenants";
import type { DashboardTenant } from "@/services/hermes/tenants";

export default function TenantSwitcher({
  tenants,
  activeTenantId,
}: {
  tenants: DashboardTenant[];
  activeTenantId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (tenants.length < 2) return null;

  const selectTenant = (tenantId: string) => {
    if (tenantId === activeTenantId || pending) return;
    startTransition(async () => {
      const result = await setActiveTenantAction(tenantId);
      if (result.ok) router.refresh();
    });
  };

  return (
    <div className="profile-switcher" role="group" aria-label="Choisir l’entreprise">
      <span className="profile-switcher-label">
        <Building2 size={15} strokeWidth={1.8} aria-hidden />
        Entreprise
      </span>
      <div className="profile-switcher-chips">
        {tenants.map((tenant) => {
          const isActive = tenant.tenantId === activeTenantId;
          const label = tenant.tenantId === "style_paint" ? "Style Paint — Peinture" : tenant.displayName;
          return (
            <button
              key={tenant.tenantId}
              type="button"
              className={`profile-chip${isActive ? " is-active" : ""}`}
              aria-pressed={isActive}
              disabled={pending}
              title={tenant.vertical === "construction" ? "Entreprise de peinture / BTP" : tenant.displayName}
              onClick={() => selectTenant(tenant.tenantId)}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
