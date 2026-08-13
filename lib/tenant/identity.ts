/**
 * Pure, DOM-free helpers for rendering the ACTIVE tenant's identity (company
 * name + logo/initials) in the dashboard. The identity itself always comes from
 * the server (`public.get_active_tenant_identity`, which resolves the tenant via
 * `resolve_active_tenant` — never a client-supplied id); these helpers only pick
 * the display label and derive fallback initials. Unit-tested.
 */

export type TenantLabelInput = {
  displayName?: string | null;
  name?: string | null;
  tenantId?: string | null;
};

/** Preferred label: display_name → name → tenant_id (slug) → null. */
export function tenantLabel(t: TenantLabelInput): string | null {
  const pick = (v?: string | null) => (v && v.trim().length > 0 ? v.trim() : null);
  return pick(t.displayName) ?? pick(t.name) ?? pick(t.tenantId) ?? null;
}

/**
 * Fallback initials when no logo is configured. Two words → first letter of each;
 * a single word → its first two characters. Always upper-case.
 */
export function tenantInitials(label: string): string {
  const cleaned = (label ?? "").trim();
  if (cleaned.length === 0) return "—";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}
