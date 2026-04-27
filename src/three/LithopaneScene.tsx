import { useRef, useMemo, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { LithopaneGeometry } from './LithopaneMesh';

interface Props {
  lithoGeo: LithopaneGeometry | null;
  maxThickness: number;
  baseLayerHeightMm: number;
  layerHeightMm: number;
  lightIntensity: number;
  absorptionCoefficient: number;
  showNotches: boolean;
}

/**
 * ShaderMaterial that simulates backlit white PLA.
 * Reads Z from vertex position directly — no clone/color-attribute needed.
 * Lambert-Beer per-layer: each discrete layer height gets its own
 * absorption-based brightness, so all layer heights are visually distinct.
 * BG pixels (Z < baseLayer) render as maximally bright (thinnest plastic).
 */
function useBacklitMaterial(maxThickness: number, baseLayerHeightMm: number, layerHeightMm: number, lightIntensity: number, absorptionCoefficient: number) {
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uMaxThickness: { value: maxThickness },
        uBaseLayer: { value: baseLayerHeightMm },
        uLayerHeight: { value: layerHeightMm },
        uLightIntensity: { value: lightIntensity },
        uMu: { value: absorptionCoefficient },
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
        uniform float uBaseLayer;
        uniform float uLayerHeight;
        uniform float uLightIntensity;
        uniform float uMu;
        varying float vZ;
        void main() {
          // Warm white PLA base
          vec3 warmWhite = vec3(1.0, 0.95, 0.85);

          // Back faces: uniform dark opaque plastic.
          // Prevents bright BG pixels from "shining through" when the
          // model is rotated, and makes z-fighting between the bottom
          // cap and thin BG area visually imperceptible (both dark).
          if (!gl_FrontFacing) {
            gl_FragColor = vec4(warmWhite * 0.08, 1.0);
            return;
          }

          float brightness;
          if (vZ <= 0.001) {
            // Rim / bottom cap / folded exterior — opaque edge
            brightness = 0.04;
          } else {
            // Lambert-Beer absorption: thinner = brighter, thicker = darker.
            // BG-removed pixels (Z < baseLayer) are ultra-thin and render
            // as the brightest areas. No clamping — use actual Z directly.
            brightness = exp(-uMu * vZ) * uLightIntensity;
            brightness = clamp(0.08 + brightness * 0.92, 0.0, 1.0);
          }

          gl_FragColor = vec4(warmWhite * brightness, 1.0);
        }
      `,
      side: THREE.DoubleSide,
    });
  }, [maxThickness, baseLayerHeightMm, layerHeightMm, lightIntensity, absorptionCoefficient]);
  useEffect(() => () => { material.dispose(); }, [material]);
  return material;
}

/** Automatically adjusts camera distance when the geometry first appears or its bounding size changes significantly. */
function CameraController({ lithoGeo, maxThickness }: { lithoGeo: LithopaneGeometry | null; maxThickness: number }) {
  const { camera } = useThree();
  const prevRadiusRef = useRef(0);
  useEffect(() => {
    if (!lithoGeo) return;
    lithoGeo.body.computeBoundingSphere();
    const sphere = lithoGeo.body.boundingSphere;
    if (!sphere) return;
    // Only reposition camera when the model size changes significantly (>20%),
    // not on every live frame update. This preserves user orbit orientation.
    const prevR = prevRadiusRef.current;
    if (prevR > 0 && Math.abs(sphere.radius - prevR) / prevR < 0.2) return;
    prevRadiusRef.current = sphere.radius;
    const perspCam = camera as THREE.PerspectiveCamera;
    const fovRad = perspCam.fov * (Math.PI / 180);
    const dist = sphere.radius / Math.sin(fovRad / 2);
    const newZ = Math.max(dist * 1.3, maxThickness * 5 + 20);
    camera.position.set(0, 0, newZ);
    perspCam.far = newZ * 10;
    perspCam.updateProjectionMatrix();
  }, [lithoGeo, maxThickness, camera]);
  return null;
}

function LithopaneMeshView({ lithoGeo, maxThickness, baseLayerHeightMm, layerHeightMm, lightIntensity, absorptionCoefficient, showNotches }: Props) {
  const meshRef = useRef<THREE.Mesh>(null);
  const material = useBacklitMaterial(maxThickness, baseLayerHeightMm, layerHeightMm, lightIntensity, absorptionCoefficient);

  if (!lithoGeo) return null;

  return (
    <>
      <mesh ref={meshRef} geometry={lithoGeo.body} material={material} />
      {showNotches && lithoGeo.notches && (
        <mesh geometry={lithoGeo.notches} material={material} />
      )}
    </>
  );
}

export default function LithopaneScene({ lithoGeo, maxThickness, baseLayerHeightMm, layerHeightMm, lightIntensity, absorptionCoefficient, showNotches }: Props) {
  // Adapt camera distance so the model is always visible, even at large diameters
  const cameraZ = Math.max(50, maxThickness * 5 + 20);
  return (
    <Canvas
      className="preview-panel__canvas"
      camera={{ position: [0, 0, cameraZ], fov: 45, near: 0.1, far: cameraZ * 10 }}
      eventPrefix="offset"
    >
      <color attach="background" args={['#0a0a14']} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
      <CameraController lithoGeo={lithoGeo} maxThickness={maxThickness} />
      <LithopaneMeshView lithoGeo={lithoGeo} maxThickness={maxThickness} baseLayerHeightMm={baseLayerHeightMm} layerHeightMm={layerHeightMm} lightIntensity={lightIntensity} absorptionCoefficient={absorptionCoefficient} showNotches={showNotches} />
    </Canvas>
  );
}
