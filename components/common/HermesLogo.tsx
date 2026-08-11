/**
 * Official Hermès OS logo — a geometric "H" with a central star / core.
 * Single source of truth for the brand mark. Use `withWordmark` for the header /
 * sidebar lockup, and the symbol alone as an app icon. Keep to at most two strong
 * appearances per screen.
 */

type HermesLogoProps = {
  size?: number;
  withWordmark?: boolean;
  className?: string;
};

export function HermesLogoSymbol({ size = 28 }: { size?: number }) {
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
        <linearGradient id="hermesLogoGrad" x1="6" y1="4" x2="42" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--hermes-cyan)" />
          <stop offset="1" stopColor="var(--hermes-blue)" />
        </linearGradient>
      </defs>
      {/* Geometric H — two uprights + crossbar */}
      <path
        d="M11 7h6v13.5h14V7h6v34h-6V26.5H17V41h-6V7Z"
        fill="url(#hermesLogoGrad)"
      />
      {/* Central star / core */}
      <path
        d="M24 16.6l1.9 4.1 4.5.5-3.3 3 .9 4.4-4-2.2-4 2.2.9-4.4-3.3-3 4.5-.5 1.9-4.1Z"
        fill="var(--text-primary)"
        opacity="0.96"
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
