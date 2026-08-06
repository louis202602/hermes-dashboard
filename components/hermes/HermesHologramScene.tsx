"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";

function HermesCore() {
  const group = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);

  useFrame((state, delta) => {
    if (group.current) {
      group.current.rotation.y += delta * 0.08;
      group.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.25) * 0.04;
    }

    if (core.current) {
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 1.4) * 0.035;
      core.current.scale.setScalar(pulse);
    }
  });

  return (
    <group ref={group}>
      <mesh>
        <sphereGeometry args={[1.55, 64, 64]} />
        <meshPhysicalMaterial
          color="#071426"
          roughness={0.2}
          metalness={0.35}
          transparent
          opacity={0.92}
        />
      </mesh>

      <mesh>
        <sphereGeometry args={[1.57, 32, 32]} />
        <meshBasicMaterial
          color="#188cff"
          wireframe
          transparent
          opacity={0.12}
        />
      </mesh>

      <mesh ref={core}>
        <sphereGeometry args={[0.48, 48, 48]} />
        <meshBasicMaterial color="#8fd8ff" />
      </mesh>

      <pointLight color="#36a8ff" intensity={8} distance={6} />

      <mesh rotation={[Math.PI / 2.5, 0, 0]}>
        <torusGeometry args={[1.9, 0.012, 12, 128]} />
        <meshBasicMaterial
          color="#38a9ff"
          transparent
          opacity={0.5}
        />
      </mesh>

      <mesh rotation={[0.3, Math.PI / 2.2, 0.5]}>
        <torusGeometry args={[2.05, 0.008, 12, 128]} />
        <meshBasicMaterial
          color="#7acbff"
          transparent
          opacity={0.25}
        />
      </mesh>
    </group>
  );
}

export default function HermesHologramScene() {
  return (
    <Canvas
      camera={{ position: [0, 0, 5.5], fov: 45 }}
      dpr={[1, 1.5]}
      gl={{ alpha: true, antialias: true }}
    >
      <ambientLight intensity={0.3} />
      <HermesCore />
    </Canvas>
  );
}
