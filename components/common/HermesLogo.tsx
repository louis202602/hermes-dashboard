/**
 * Official Hermès OS logo — V3.
 *
 * A premium geometric "H": two pill-shaped uprights joined by a flowing cyan→blue
 * ribbon, with a central 4-point spark. Single source of truth for the brand mark.
 *
 * Usage rules (per the validated V3 brand sheet):
 *  - Symbol alone (`HermesLogoSymbol`) for the compact sidebar, favicon and app
 *    icon, and small placements.
 *  - `HermesLogo withWordmark` for wide placements (H + "HERMÈS OS").
 *  - The marketing baseline "INTELLIGENCE · AUTOMATION · IMPACT" is NEVER shown in
 *    the dashboard (reserved for web / marketing surfaces).
 *  - Legible at 16 / 32 / 64 px; theme-aware (gradient uses the design tokens).
 *  - Keep to at most two strong brand appearances per screen.
 */

type HermesLogoProps = {
  size?: number;
  withWordmark?: boolean;
  className?: string;
};

export function HermesLogoSymbol({ size = 28 }: { size?: number }) {
  // A per-instance gradient id keeps multiple marks on one page independent.
  const gid = `hLogoV3-${size}`;
  return (
    <svg
      className="hermes-logo-symbol"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="Hermès OS"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gid} x1="8" y1="6" x2="40" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--hermes-cyan)" />
          <stop offset="0.55" stopColor="var(--hermes-blue)" />
          <stop offset="1" stopColor="var(--accent-strong)" />
        </linearGradient>
      </defs>

      {/* Two pill uprights */}
      <rect x="9" y="6.5" width="7" height="35" rx="3.5" fill={`url(#${gid})`} />
      <rect x="32" y="6.5" width="7" height="35" rx="3.5" fill={`url(#${gid})`} />

      {/* Flowing ribbon crossbar — the V3 signature: a HORIZONTAL wave joining the
          two uprights (kept horizontal so the H silhouette reads at every size). */}
      <path
        d="M16 24 C19 20, 22 20, 24 24 S29 28, 32 24"
        stroke={`url(#${gid})`}
        strokeWidth="5.6"
        strokeLinecap="round"
        fill="none"
      />

      {/* Central 4-point spark — consistently light so it reads on the blue mark in
          both themes */}
      <path
        d="M24 15.6 l1.5 3.7 l3.7 1.5 l-3.7 1.5 l-1.5 3.7 l-1.5 -3.7 l-3.7 -1.5 l3.7 -1.5 z"
        fill="#f2f9ff"
      />
    </svg>
  );
}

export default function HermesLogo({
  size = 28,
  withWordmark = false,
  className,
}: HermesLogoProps) {
  return (
    <span className={`hermes-logo${className ? ` ${className}` : ""}`}>
      <HermesLogoSymbol size={size} />
      {withWordmark ? (
        <span className="hermes-logo-wordmark">
          <strong>HERMÈS OS</strong>
          <span>DIRECTEUR GÉNÉRAL IA</span>
        </span>
      ) : null}
    </span>
  );
}
