"use client";

import dynamic from "next/dynamic";
import { Component, type ReactNode, useEffect, useState } from "react";
import HermesHologramFallback from "./HermesHologramFallback";
import type { HermesHologramProps, HermesQuality, ResolvedQuality } from "./hermes-hologram.types";

// Chargement du Canvas Three.js uniquement côté client (aucun rendu SSR).
const HermesHologramScene = dynamic(() => import("./HermesHologramScene"), {
  ssr: false,
  loading: () => <HermesHologramFallback />,
});

type BoundaryProps = { children: ReactNode; fallback: ReactNode };
type BoundaryState = { hasError: boolean };

class HologramErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

function resolveQuality(requested: HermesQuality): ResolvedQuality {
  if (requested !== "auto") return requested;
  if (typeof window === "undefined") return "medium";
  const width = window.innerWidth;
  const dpr = window.devicePixelRatio || 1;
  if (width < 640 || dpr > 2.5) return "low";
  if (width < 1024) return "medium";
  return "high";
}

/**
 * Hologramme Hermès — noyau IA en 3D (React Three Fiber).
 * Ce wrapper ne contient aucune logique 3D lui-même : il ne fait que
 * résoudre la qualité, détecter WebGL / prefers-reduced-motion, et
 * déléguer tout le rendu à HermesHologramScene (ou au fallback CSS/SVG).
 */
export default function HermesHologram({
  state = "idle",
  quality = "auto",
  className = "",
  reducedMotion,
}: HermesHologramProps) {
  const [ready, setReady] = useState(false);
  const [supportsWebGL, setSupportsWebGL] = useState(true);
  const [prefersReduced, setPrefersReduced] = useState(false);
  const [resolvedQuality, setResolvedQuality] = useState<ResolvedQuality>("medium");

  useEffect(() => {
    setReady(true);
    setResolvedQuality(resolveQuality(quality));

    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      setSupportsWebGL(!!gl);
    } catch {
      setSupportsWebGL(false);
    }

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReduced(media.matches);
    const onChange = () => setPrefersReduced(media.matches);
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, [quality]);

  const effectiveReducedMotion = reducedMotion ?? prefersReduced;

  if (!ready || !supportsWebGL) {
    return (
      <div className={className}>
        <span className="sr-only" role="status">
          Hermès — statut : {state}
        </span>
        <HermesHologramFallback state={state} />
      </div>
    );
  }

  return (
    <div className={className}>
      <span className="sr-only" role="status">
        Hermès — statut : {state}
      </span>
      <HologramErrorBoundary fallback={<HermesHologramFallback state={state} />}>
        <HermesHologramScene state={state} quality={resolvedQuality} reducedMotion={effectiveReducedMotion} />
      </HologramErrorBoundary>
    </div>
  );
}

