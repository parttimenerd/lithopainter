import { useRef, useMemo, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

interface Props {
  geometry: THREE.BufferGeometry | null;
  maxThickness: number;
  layerHeightMm: number;
}

/**
 * ShaderMaterial that simulates backlit white PLA.
 * Reads Z from vertex position directly — no clone/color-attribute needed.
 * Lambert-Beer: thinner = brighter, thicker = darker.
 */
function useBacklitMaterial(maxThickness: number, layerHeightMm: number) {
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uMaxThickness: { value: maxThickness },
        uMinThickness: { value: layerHeightMm },
      },
      vertexShader: /* glsl */ `
        varying float vZ;
        void main() {
          vZ = position.z;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uMaxThickness;
        uniform float uMinThickness;
        varying float vZ;
        void main() {
          // Warm white PLA base
          vec3 warmWhite = vec3(1.0, 0.95, 0.85);

          float brightness;
          if (vZ <= 0.001) {
            // Rim / bottom cap / folded exterior — opaque edge
            brightness = 0.04;
          } else {
            // Lambert-Beer: I/I0 = exp(-alpha * d)
            float t = clamp((vZ - uMinThickness) / (uMaxThickness - uMinThickness), 0.0, 1.0);
            brightness = exp(-t * 3.0);
            brightness = 0.08 + brightness * 0.92;
          }

          gl_FragColor = vec4(warmWhite * brightness, 1.0);
        }
      `,
      side: THREE.DoubleSide,
    });
  }, [maxThickness, layerHeightMm]);
  useEffect(() => () => { material.dispose(); }, [material]);
  return material;
}

function LithopaneMeshView({ geometry, maxThickness, layerHeightMm }: Props & { layerHeightMm: number }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const material = useBacklitMaterial(maxThickness, layerHeightMm);

  if (!geometry) return null;

  return (
    <mesh ref={meshRef} geometry={geometry} material={material} />
  );
}

export default function LithopaneScene({ geometry, maxThickness, layerHeightMm }: Props) {
  return (
    <Canvas
      className="preview-panel__canvas"
      camera={{ position: [0, 0, 50], fov: 45, near: 0.1, far: 500 }}
    >
      <color attach="background" args={['#0a0a14']} />
      <OrbitControls enableDamping dampingFactor={0.1} />
      <LithopaneMeshView geometry={geometry} maxThickness={maxThickness} layerHeightMm={layerHeightMm} />
    </Canvas>
  );
}
