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
      {/* Geometric H — two symmetric uprights + a balanced crossbar */}
      <path
        d="M10 8h5v13h18V8h5v32h-5V27H15v13h-5V8Z"
        fill="url(#hermesLogoGrad)"
      />
      {/* Central core — a compact 4-point sparkle, legible at small sizes */}
      <path
        d="M24 18.5 L25.6 22.4 L29.5 24 L25.6 25.6 L24 29.5 L22.4 25.6 L18.5 24 L22.4 22.4 Z"
        fill="var(--text-primary)"
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
