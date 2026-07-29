"use client";

import { STATE_COLORS, type HermesState } from "./hermes-hologram.types";

/**
 * Version CSS/SVG statique de l'hologramme Hermès.
 * Affichée : pendant le chargement du composant 3D, si WebGL est
 * indisponible, ou si la scène Three.js rencontre une erreur.
 */
export default function HermesHologramFallback({ state = "idle" }: { state?: HermesState }) {
  const colors = STATE_COLORS[state];

  return (
    <div className="relative flex h-56 w-56 items-center justify-center sm:h-64 sm:w-64" aria-hidden="true">
      <div
        className="absolute h-full w-full rounded-full blur-3xl"
        style={{ backgroundColor: colors.core, opacity: 0.15 }}
      />
      <span className="absolute inset-0 rounded-full border" style={{ borderColor: `${colors.ring}20` }} />
      <span className="absolute inset-3 rounded-full border" style={{ borderColor: `${colors.ring}15` }} />
      <span
        className="absolute h-40 w-full rounded-full border"
        style={{ borderColor: `${colors.ring}40` }}
      />
      <span
        className="absolute h-36 w-[85%] rounded-full border [transform:rotate(35deg)]"
        style={{ borderColor: `${colors.ring}30` }}
      />
      <div
        className="relative flex h-32 w-32 items-center justify-center rounded-full sm:h-36 sm:w-36"
        style={{
          background: `radial-gradient(circle at 35% 30%, ${colors.core}55, ${colors.core}15 70%)`,
          border: `1px solid ${colors.ring}60`,
          boxShadow: `0 0 60px ${colors.core}40, inset 0 0 30px ${colors.ring}30`,
        }}
      >
        <span className="text-5xl font-semibold text-white sm:text-6xl">Σ</span>
      </div>
    </div>
  );
}

