"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { STATE_COLORS, STATE_CONFIG, type HermesState, type ResolvedQuality } from "./hermes-hologram.types";

type SceneProps = {
  state: HermesState;
  quality: ResolvedQuality;
  reducedMotion: boolean;
};

const QUALITY_CONFIG: Record<ResolvedQuality, { particles: number; dpr: [number, number] }> = {
  low: { particles: 18, dpr: [1, 1] },
  medium: { particles: 36, dpr: [1, 1.5] },
  high: { particles: 60, dpr: [1, 1.5] },
};

type PointerRef = { current: { x: number; y: number } };

/* ============================================================
   GÉOMÉTRIE DU Σ — segments droits, angles nets, coupures
   ============================================================ */

const SIGMA_VECTORS = [
  new THREE.Vector3(0.5, 0.66, 0.03),
  new THREE.Vector3(-0.5, 0.66, -0.03),
  new THREE.Vector3(0.07, 0.05, 0.05),
  new THREE.Vector3(-0.5, -0.66, -0.03),
  new THREE.Vector3(0.5, -0.66, 0.03),
];

/** Position sur le tracé du Σ pour t ∈ [0,1] (mise à l'échelle), écrite dans `target`. */
function sigmaPointAtT(t: number, target: THREE.Vector3, scale: number) {
  const clamped = Math.max(0, Math.min(0.9999, t));
  const legIndex = Math.floor(clamped * 4);
  const localT = clamped * 4 - legIndex;
  const a = SIGMA_VECTORS[legIndex];
  const b = SIGMA_VECTORS[legIndex + 1];
  target.set(
    (a.x + (b.x - a.x) * localT) * scale,
    (a.y + (b.y - a.y) * localT) * scale,
    (a.z + (b.z - a.z) * localT) * scale
  );
}

/** Un segment droit, raccourci aux deux bouts pour laisser une rupture lumineuse à chaque angle. */
function buildLegGeometry(a: THREE.Vector3, b: THREE.Vector3, radius: number, inset: number) {
  const start = a.clone().lerp(b, inset);
  const end = a.clone().lerp(b, 1 - inset);
  const curve = new THREE.LineCurve3(start, end);
  return new THREE.TubeGeometry(curve, 8, radius, 6, false);
}

/** Icosaèdre dont les sommets sont légèrement déplacés (une fois, à la construction). */
function buildDeformedShell(radius: number, amount: number) {
  const geometry = new THREE.IcosahedronGeometry(radius, 2);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const offset = amount * (Math.sin(x * 6) + Math.sin(y * 5) + Math.sin(z * 7)) * 0.33;
    const s = 1 + offset;
    position.setXYZ(i, x * s, y * s, z * s);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** Arc incomplet (portion de cercle) — pas un tore entier. */
function buildArcGeometry(radius: number, tubeRadius: number, spanDegrees: number, startDegrees: number) {
  const points: THREE.Vector3[] = [];
  const segments = 48;
  const spanRad = (spanDegrees * Math.PI) / 180;
  const startRad = (startDegrees * Math.PI) / 180;
  for (let i = 0; i <= segments; i++) {
    const angle = startRad + (i / segments) * spanRad;
    points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0));
  }
  const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.3);
  return new THREE.TubeGeometry(curve, segments, tubeRadius, 6, false);
}

/** Nuage de particules d'ambiance à une profondeur donnée (fonction pure, hors composant). */
function createDepthLayer(count: number, rMin: number, rMax: number, scale: number) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const radius = rMin + Math.random() * (rMax - rMin);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta) * scale;
    positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta) * scale;
    positions[i * 3 + 2] = radius * Math.cos(phi) * scale;
  }
  return positions;
}

function HologramGroup({
  state,
  quality,
  reducedMotion,
  pointerRef,
}: SceneProps & { pointerRef: PointerRef }) {
  const groupRef = useRef<THREE.Group>(null);
  const outerGlowRef = useRef<THREE.Mesh>(null);
  const envelopeRef = useRef<THREE.Mesh>(null);
  const shellRef = useRef<THREE.Mesh>(null);
  const denseCoreRef = useRef<THREE.Mesh>(null);
  const arc1 = useRef<THREE.Mesh>(null);
  const arc2 = useRef<THREE.Mesh>(null);
  const arc3 = useRef<THREE.Mesh>(null);
  const flux1 = useRef<THREE.Mesh>(null);
  const flux2 = useRef<THREE.Mesh>(null);
  const flux3 = useRef<THREE.Mesh>(null);
  const sigmaParticlesRef = useRef<THREE.Points>(null);
  const particlesNearRef = useRef<THREE.Points>(null);
  const particlesMidRef = useRef<THREE.Points>(null);
  const particlesFarRef = useRef<THREE.Points>(null);
  const legCoreRefs = useRef<(THREE.Mesh | null)[]>([null, null, null, null]);
  const legHaloRefs = useRef<(THREE.Mesh | null)[]>([null, null, null, null]);

  const currentGlow = useRef(new THREE.Color(STATE_COLORS.idle.core));
  const targetGlow = useRef(new THREE.Color(STATE_COLORS.idle.core));
  const currentFlow = useRef(new THREE.Color(STATE_COLORS.idle.ring));
  const targetFlow = useRef(new THREE.Color(STATE_COLORS.idle.ring));
  const liveConfig = useRef({ speed: 1, pulse: 0.03, brightness: 1 });
  const scratch = useRef(new THREE.Vector3());

  useEffect(() => {
    targetGlow.current.set(STATE_COLORS[state].core);
    targetFlow.current.set(STATE_COLORS[state].ring);
  }, [state]);

  const config = QUALITY_CONFIG[quality];
  const scale = 1.2; // hologramme ~20% plus imposant, même conteneur

  /* --- Géométries construites une seule fois --- */

  const envelopeGeometry = useMemo(() => new THREE.IcosahedronGeometry(1.05 * scale, 1), []);
  const shellGeometry = useMemo(() => buildDeformedShell(0.68 * scale, 0.12), []);

  const legGeometries = useMemo(() => {
    const inset = 0.09;
    return SIGMA_VECTORS.slice(0, 4).map((a, i) => {
      const b = SIGMA_VECTORS[i + 1];
      const aScaled = a.clone().multiplyScalar(scale);
      const bScaled = b.clone().multiplyScalar(scale);
      return {
        core: buildLegGeometry(aScaled, bScaled, 0.018 * scale, inset),
        halo: buildLegGeometry(aScaled, bScaled, 0.045 * scale, inset),
      };
    });
  }, []);

  const arcGeometries = useMemo(
    () => [
      buildArcGeometry(0.82 * scale, 0.003 * scale, 250, -30),
      buildArcGeometry(0.7 * scale, 0.0026 * scale, 190, 140),
      buildArcGeometry(0.94 * scale, 0.0022 * scale, 300, 260),
    ],
    []
  );

  const fluxGeometries = useMemo(() => {
    const build = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) =>
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a, b, c]), 24, 0.005 * scale, 6, false);
    return [
      build(
        new THREE.Vector3(-0.55, 0.15, 0.2).multiplyScalar(scale),
        new THREE.Vector3(0, -0.08, 0).multiplyScalar(scale),
        new THREE.Vector3(0.55, -0.25, -0.2).multiplyScalar(scale)
      ),
      build(
        new THREE.Vector3(0.35, 0.55, -0.15).multiplyScalar(scale),
        new THREE.Vector3(-0.08, 0, 0.12).multiplyScalar(scale),
        new THREE.Vector3(-0.45, -0.5, -0.08).multiplyScalar(scale)
      ),
      build(
        new THREE.Vector3(-0.4, -0.45, 0.12).multiplyScalar(scale),
        new THREE.Vector3(0.06, 0.12, -0.12).multiplyScalar(scale),
        new THREE.Vector3(0.45, 0.4, 0.18).multiplyScalar(scale)
      ),
    ];
  }, []);

  // Particules du Σ : phase de circulation + léger décalage fixe (déjà à l'échelle finale)
  const sigmaParticleCount = 30;
  const sigmaPositions = useMemo(() => new Float32Array(sigmaParticleCount * 3), []);
  const sigmaPhases = useMemo(
    () => Array.from({ length: sigmaParticleCount }, (_, i) => i / sigmaParticleCount),
    []
  );
  const sigmaJitter = useMemo(
    () =>
      Array.from({ length: sigmaParticleCount }, () => ({
        x: Math.sin(Math.random() * 10) * 0.02 * scale,
        y: Math.cos(Math.random() * 10) * 0.02 * scale,
      })),
    []
  );

  // Trois profondeurs de particules d'ambiance — trois useMemo distincts, au niveau du composant.
  const nearPositions = useMemo(
    () => createDepthLayer(Math.round(config.particles * 0.35), 0.55, 0.75, scale),
    [config.particles]
  );
  const midPositions = useMemo(
    () => createDepthLayer(Math.round(config.particles * 0.4), 0.85, 1.05, scale),
    [config.particles]
  );
  const farPositions = useMemo(
    () => createDepthLayer(Math.round(config.particles * 0.25), 1.15, 1.4, scale),
    [config.particles]
  );

  /* --- Libération mémoire des géométries construites manuellement --- */
  useEffect(() => {
    return () => {
      envelopeGeometry.dispose();
      shellGeometry.dispose();
      legGeometries.forEach(({ core, halo }) => {
        core.dispose();
        halo.dispose();
      });
      arcGeometries.forEach((g) => g.dispose());
      fluxGeometries.forEach((g) => g.dispose());
    };
  }, [envelopeGeometry, shellGeometry, legGeometries, arcGeometries, fluxGeometries]);

  useFrame((three, delta) => {
    const target = STATE_CONFIG[state];
    const lerpSpeed = Math.min(delta * 1.2, 1);

    liveConfig.current.speed += (target.speed - liveConfig.current.speed) * lerpSpeed;
    liveConfig.current.pulse += (target.pulse - liveConfig.current.pulse) * lerpSpeed;
    liveConfig.current.brightness += (target.brightness - liveConfig.current.brightness) * lerpSpeed;

    currentGlow.current.lerp(targetGlow.current, lerpSpeed);
    currentFlow.current.lerp(targetFlow.current, lerpSpeed);

    const motionScale = reducedMotion ? 0.05 : 1;
    const speed = liveConfig.current.speed * motionScale;
    const pulseAmp = liveConfig.current.pulse * motionScale;
    const t = three.clock.elapsedTime;

    if (envelopeRef.current) envelopeRef.current.rotation.y += delta * 0.02 * speed;
    if (shellRef.current) shellRef.current.rotation.y += delta * -0.035 * speed;
    if (arc1.current) arc1.current.rotation.z += delta * 0.07 * speed;
    if (arc2.current) arc2.current.rotation.x += delta * -0.05 * speed;
    if (arc3.current) arc3.current.rotation.y += delta * 0.04 * speed;
    if (particlesFarRef.current) particlesFarRef.current.rotation.y += delta * 0.01 * speed;
    if (particlesMidRef.current) particlesMidRef.current.rotation.y += delta * -0.016 * speed;
    if (particlesNearRef.current) particlesNearRef.current.rotation.y += delta * 0.022 * speed;

    const breathe = (phase: number) => 0.16 + 0.06 * Math.sin(t * 0.5 * motionScale + phase);
    if (flux1.current) (flux1.current.material as THREE.MeshBasicMaterial).opacity = breathe(0);
    if (flux2.current) (flux2.current.material as THREE.MeshBasicMaterial).opacity = breathe(2.1);
    if (flux3.current) (flux3.current.material as THREE.MeshBasicMaterial).opacity = breathe(4.2);

    for (let i = 0; i < 4; i++) {
      const wave = 0.55 + 0.45 * Math.sin(t * 0.9 * motionScale - i * 1.4);
      const coreMesh = legCoreRefs.current[i];
      const haloMesh = legHaloRefs.current[i];
      if (coreMesh) (coreMesh.material as THREE.MeshBasicMaterial).opacity = 0.65 + 0.35 * wave;
      if (haloMesh) (haloMesh.material as THREE.MeshBasicMaterial).opacity = (0.18 + 0.14 * wave) * liveConfig.current.brightness;
    }

    const pulse = 1 + Math.sin(t * 0.5) * pulseAmp;
    if (denseCoreRef.current) denseCoreRef.current.scale.setScalar(pulse * 0.85);
    if (outerGlowRef.current) outerGlowRef.current.scale.setScalar(pulse * 1.04);
    if (shellRef.current) shellRef.current.scale.setScalar(1 + Math.sin(t * 0.4 + 1) * 0.015);

    if (outerGlowRef.current) {
      const material = outerGlowRef.current.material as THREE.MeshBasicMaterial;
      material.color.copy(currentGlow.current);
      material.opacity = 0.14 * liveConfig.current.brightness;
    }
    if (arc1.current) (arc1.current.material as THREE.MeshBasicMaterial).color.copy(currentFlow.current);
    if (arc2.current) (arc2.current.material as THREE.MeshBasicMaterial).color.copy(currentFlow.current);

    // Particules du Σ : circulation réelle le long du tracé, échelle cohérente (buffer réutilisé)
    if (sigmaParticlesRef.current) {
      const positionAttr = sigmaParticlesRef.current.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < sigmaParticleCount; i++) {
        sigmaPhases[i] = (sigmaPhases[i] + delta * 0.06 * speed) % 1;
        sigmaPointAtT(sigmaPhases[i], scratch.current, scale);
        const jitter = sigmaJitter[i];
        positionAttr.setXYZ(i, scratch.current.x + jitter.x, scratch.current.y + jitter.y, scratch.current.z);
      }
      positionAttr.needsUpdate = true;
    }

    if (groupRef.current) {
      const targetX = pointerRef.current.y * 0.09;
      const targetY = pointerRef.current.x * 0.13;
      const followSpeed = Math.min(delta * 1.5, 1);
      groupRef.current.rotation.x += (targetX - groupRef.current.rotation.x) * followSpeed;
      groupRef.current.rotation.y += (targetY - groupRef.current.rotation.y) * followSpeed;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh ref={outerGlowRef}>
        <sphereGeometry args={[0.62 * scale, 24, 24]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.14} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>

      <mesh ref={envelopeRef} geometry={envelopeGeometry}>
        <meshBasicMaterial color="#cbd5e1" wireframe transparent opacity={0.045} />
      </mesh>

      <mesh ref={shellRef} geometry={shellGeometry}>
        <meshBasicMaterial color="#cbd5e1" wireframe transparent opacity={0.07} />
      </mesh>

      <mesh ref={denseCoreRef}>
        <sphereGeometry args={[0.3 * scale, 32, 32]} />
        <meshBasicMaterial color="#f5faff" transparent opacity={0.88} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>

      <mesh ref={arc1} geometry={arcGeometries[0]}>
        <meshBasicMaterial color="#7dd3fc" transparent opacity={0.3} />
      </mesh>
      <mesh ref={arc2} geometry={arcGeometries[1]}>
        <meshBasicMaterial color="#7dd3fc" transparent opacity={0.22} />
      </mesh>
      <mesh ref={arc3} geometry={arcGeometries[2]}>
        <meshBasicMaterial color="#c4b5fd" transparent opacity={0.1} />
      </mesh>

      <mesh ref={flux1} geometry={fluxGeometries[0]}>
        <meshBasicMaterial color="#93c5fd" transparent opacity={0.16} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={flux2} geometry={fluxGeometries[1]}>
        <meshBasicMaterial color="#93c5fd" transparent opacity={0.16} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={flux3} geometry={fluxGeometries[2]}>
        <meshBasicMaterial color="#93c5fd" transparent opacity={0.16} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>

      {legGeometries.map((leg, i) => (
        <group key={i}>
          <mesh
            ref={(mesh) => {
              legHaloRefs.current[i] = mesh;
            }}
            geometry={leg.halo}
          >
            <meshBasicMaterial color="#bfe3ff" transparent opacity={0.2} depthWrite={false} blending={THREE.AdditiveBlending} />
          </mesh>
          <mesh
            ref={(mesh) => {
              legCoreRefs.current[i] = mesh;
            }}
            geometry={leg.core}
          >
            <meshBasicMaterial color="#f8fbff" transparent opacity={0.95} depthWrite={false} blending={THREE.AdditiveBlending} />
          </mesh>
        </group>
      ))}

      <points ref={sigmaParticlesRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[sigmaPositions, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.02 * scale} color="#f8fbff" transparent opacity={0.9} sizeAttenuation blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>

      <points ref={particlesNearRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[nearPositions, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.011 * scale} color="#e2e8f0" transparent opacity={0.3} sizeAttenuation />
      </points>
      <points ref={particlesMidRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[midPositions, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.009 * scale} color="#bae6fd" transparent opacity={0.22} sizeAttenuation />
      </points>
      <points ref={particlesFarRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[farPositions, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.007 * scale} color="#94a3b8" transparent opacity={0.14} sizeAttenuation />
      </points>
    </group>
  );
}

export default function HermesHologramScene({ state, quality, reducedMotion }: SceneProps) {
  const config = QUALITY_CONFIG[quality];
  const pointerRef = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Le Canvas reste pointer-events-none (non interactif). Ce conteneur, lui,
  // reçoit les événements natifs qui "traversent" le canvas transparent —
  // sans jamais intercepter de clics ailleurs sur le dashboard.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const handleMove = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      pointerRef.current.x = (event.clientX - rect.left) / rect.width - 0.5;
      pointerRef.current.y = (event.clientY - rect.top) / rect.height - 0.5;
    };
    const handleLeave = () => {
      pointerRef.current.x = 0;
      pointerRef.current.y = 0;
    };

    node.addEventListener("pointermove", handleMove);
    node.addEventListener("pointerleave", handleLeave);
    return () => {
      node.removeEventListener("pointermove", handleMove);
      node.removeEventListener("pointerleave", handleLeave);
    };
  }, []);

  return (
    <div ref={containerRef} className="h-full w-full">
      <Canvas
        className="pointer-events-none"
        dpr={config.dpr}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
        camera={{ position: [0, 0, 2.85], fov: 36 }}
        style={{ background: "transparent" }}
      >
        <HologramGroup state={state} quality={quality} reducedMotion={reducedMotion} pointerRef={pointerRef} />
      </Canvas>
    </div>
  );
}

