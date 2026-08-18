import type { CSSProperties } from "react";

type Props = {
  /** Diameter in px. */
  size?: number;
  /** "idle" = very slow breathing; "thinking" = brighter, livelier illumination. */
  state?: "idle" | "thinking";
  className?: string;
};

/**
 * Hermès orb — the AI's visual identity. A calm, premium sphere in the house cyan/blue,
 * with a soft halo and a slow inner sheen. Purely decorative (aria-hidden), CSS/GPU-driven
 * (transform + opacity only), and quiet: a gentle breathing at rest, a brighter, slightly
 * faster illumination while Hermès is thinking. No cartoon, no gadget. Respects
 * reduce-motion (animation is neutralized globally). Reused as the header identity and as
 * the small avatar beside each Hermès message. A four-point star sits INSIDE the sphere
 * (never replacing it): calm and subtle at rest, gently glowing + rotating while Hermès
 * thinks — the sphere's living heart.
 */
export default function HermesOrb({ size = 28, state = "idle", className }: Props) {
  const style = { "--orb-size": `${size}px` } as CSSProperties;
  return (
    <span
      className={`hermes-orb is-${state}${className ? ` ${className}` : ""}`}
      style={style}
      aria-hidden
    >
      <span className="hermes-orb-core" />
      <span className="hermes-orb-ring" />
      {/* The star lives inside the sphere — a soft 4-point sparkle. */}
      <svg className="hermes-orb-star" viewBox="0 0 24 24" aria-hidden>
        <path d="M12 2 Q13 11 22 12 Q13 13 12 22 Q11 13 2 12 Q11 11 12 2 Z" />
      </svg>
    </span>
  );
}
