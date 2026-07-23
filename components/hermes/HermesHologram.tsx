"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Line, PointMaterial, Points } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";

type HermesState =
  | "idle"
  | "listening"
  | "thinking"
  | "success"
  | "warning"
  | "error"
  | "offline";

type HermesQuality = "low" | "medium" | "high" | "auto";

type HermesHologramProps = {
  state?: HermesState;
  quality?: HermesQuality;
  className?: string;
};

const palette: Record<HermesState, string> = {
  idle: "#69c7ff",
  listening: "#7bd8ff",
  thinking: "#5b94ff",
  success: "#60d7b0",
  warning: "#e8ad63",
  error: "#cf7853",
  offline: "#74889d",
};

function Scene({
  state,
  quality,
}: {
  state: HermesState;
  quality: Exclude<HermesQuality, "auto">;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const ringOneRef = useRef<THREE.Mesh>(null);
  const ringTwoRef = useRef<THREE.Mesh>(null);
  const ringThreeRef = useRef<THREE.Mesh>(null);

  const color = palette[state];

  const particleCount =
    quality === "low" ? 48 : quality === "high" ? 120 : 82;

  const particles = useMemo(() => {
    const positions = new Float32Array(particleCount * 3);

    let seed = 8431;

    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    for (let index = 0; index < particleCount; index += 1) {
      const radius = 1.2 + random() * 1.15;
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);

      positions[index * 3] =
        radius * Math.sin(phi) * Math.cos(theta);

      positions[index * 3 + 1] =
        radius * Math.cos(phi);

      positions[index * 3 + 2] =
        radius * Math.sin(phi) * Math.sin(theta);
    }

    return positions;
  }, [particleCount]);

  const orbitPoints = useMemo(() => {
    return Array.from({ length: 96 }, (_, index) => {
      const angle = (index / 95) * Math.PI * 2;

      return [
        Math.cos(angle) * 1.72,
        Math.sin(angle) * 0.5,
        0,
      ] as [number, number, number];
    });
  }, []);

  useFrame((clock, delta) => {
    if (
      !groupRef.current ||
      !ringOneRef.current ||
      !ringTwoRef.current ||
      !ringThreeRef.current
    ) {
      return;
    }

    const speed =
      state === "thinking"
        ? 1.7
        : state === "offline"
          ? 0.18
          : 0.72;

    groupRef.current.rotation.y += delta * 0.035 * speed;
    ringOneRef.current.rotation.z += delta * 0.12 * speed;
    ringTwoRef.current.rotation.x -= delta * 0.095 * speed;
    ringThreeRef.current.rotation.y += delta * 0.075 * speed;

    const pulse =
      1 +
      Math.sin(
        clock.clock.elapsedTime *
          (state === "thinking" ? 2.1 : 0.9),
      ) *
        0.022;

    groupRef.current.scale.setScalar(pulse);
  });

  return (
    <group ref={groupRef}>
      <ambientLight intensity={0.45} />

      <pointLight
        position={[0, 0.2, 2]}
        intensity={4.4}
        color={color}
        distance={7}
      />

      <mesh>
        <sphereGeometry args={[0.92, 48, 48]} />

        <meshPhysicalMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.34}
          transparent
          opacity={0.12}
          roughness={0.08}
          metalness={0.05}
          transmission={0.28}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <mesh>
        <sphereGeometry args={[1.12, 28, 28]} />

        <meshBasicMaterial
          color={color}
          wireframe
          transparent
          opacity={0.17}
          depthWrite={false}
        />
      </mesh>

      <mesh>
        <icosahedronGeometry args={[1.03, 3]} />

        <meshBasicMaterial
          color="#dff6ff"
          wireframe
          transparent
          opacity={0.08}
          depthWrite={false}
        />
      </mesh>

      <mesh
        ref={ringOneRef}
        rotation={[1.12, 0.18, 0.14]}
      >
        <torusGeometry args={[1.48, 0.009, 8, 180]} />

        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.7}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <mesh
        ref={ringTwoRef}
        rotation={[0.42, 1.2, 0.64]}
      >
        <torusGeometry args={[1.62, 0.007, 8, 180]} />

        <meshBasicMaterial
          color="#9ddcff"
          transparent
          opacity={0.38}
          depthWrite={false}
        />
      </mesh>

      <mesh
        ref={ringThreeRef}
        rotation={[1.48, 0.56, 0.92]}
      >
        <torusGeometry args={[1.28, 0.006, 8, 180]} />

        <meshBasicMaterial
          color="#e9f8ff"
          transparent
          opacity={0.26}
          depthWrite={false}
        />
      </mesh>

      <Line
        points={orbitPoints}
        color={color}
        transparent
        opacity={0.28}
        lineWidth={0.55}
      />

      <Points positions={particles} stride={3}>
        <PointMaterial
          transparent
          color={color}
          size={0.025}
          sizeAttenuation
          depthWrite={false}
          opacity={0.82}
        />
      </Points>
    </group>
  );
}

export default function HermesHologram({
  state = "idle",
  quality = "auto",
  className = "",
}: HermesHologramProps) {
  const resolvedQuality: Exclude<HermesQuality, "auto"> =
    quality === "auto"
      ? typeof window !== "undefined" &&
        window.innerWidth < 900
        ? "low"
        : "medium"
      : quality;

  return (
    <div
      className={`hermes-canvas ${className}`}
      aria-hidden="true"
    >
      <Canvas
        dpr={[
          1,
          resolvedQuality === "high"
            ? 1.75
            : 1.35,
        ]}
        camera={{
          position: [0, 0, 5.3],
          fov: 41,
        }}
        gl={{
          alpha: true,
          antialias: true,
          powerPreference: "high-performance",
        }}
      >
        <Scene
          state={state}
          quality={resolvedQuality}
        />
      </Canvas>

      <div className="sigma-mark">Σ</div>
      <div className="holo-beam" />
    </div>
  );
}
