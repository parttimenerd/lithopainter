import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { roundToPrecision } from '../utils/mathUtils';

/**
 * Generate a watertight circular lithopane BufferGeometry using the "folding plane" topology.
 *
 * Per the research doc:
 * - Start with PlaneGeometry subdivided to physical print resolution
 * - CPU-side displacement: interior vertices get heightmap Z; exterior vertices fold to circle rim at Z=0
 * - Add bottom CircleGeometry cap
 * - mergeGeometries → mergeVertices → computeVertexNormals for manifold integrity
 */
/**
 * Compute optimal notch angles biased toward thicker rim areas.
 * Samples the heightmap around the circle perimeter and places notches
 * where material is thickest — providing better structural support.
 */
function computeNotchAngles(
  heightmap: Float32Array,
  resolution: number,
  numNotches: number
): number[] {
  if (numNotches <= 0) return [];

  // Sample heights around the rim (just inside the circle boundary)
  const numSamples = 360;
  const cx = resolution / 2;
  const cy = resolution / 2;
  const r = (resolution / 2) - 2; // 2px inside the rim
  const rimHeights = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const angle = (i / numSamples) * Math.PI * 2;
    const sx = Math.round(cx + r * Math.cos(angle));
    const sy = Math.round(cy - r * Math.sin(angle)); // flip Y for image coords
    const px = Math.min(Math.max(sx, 0), resolution - 1);
    const py = Math.min(Math.max(sy, 0), resolution - 1);
    rimHeights[i] = heightmap[py * resolution + px];
  }

  // Build a cumulative weight distribution biased toward thicker areas
  // Use height^2 to strongly favor thick spots, with a floor so thin areas
  // still have some weight (avoids all notches clustering in one spot)
  const weights = new Float32Array(numSamples);
  let totalWeight = 0;
  for (let i = 0; i < numSamples; i++) {
    weights[i] = 1 + rimHeights[i] * rimHeights[i];
    totalWeight += weights[i];
  }

  // Place notches greedily: pick the highest-weight position, then exclude
  // a minimum angular separation zone around it
  const minSeparation = Math.floor(numSamples / numNotches * 0.6);
  const used = new Uint8Array(numSamples);
  const angles: number[] = [];

  for (let n = 0; n < numNotches; n++) {
    // Find the sample with highest available weight
    let bestIdx = -1;
    let bestWeight = -1;
    for (let i = 0; i < numSamples; i++) {
      if (!used[i] && weights[i] > bestWeight) {
        bestWeight = weights[i];
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;

    angles.push((bestIdx / numSamples) * Math.PI * 2);

    // Mark exclusion zone around chosen position
    for (let d = -minSeparation; d <= minSeparation; d++) {
      const idx = ((bestIdx + d) % numSamples + numSamples) % numSamples;
      used[idx] = 1;
    }
  }

  // Sort for consistent ordering
  angles.sort((a, b) => a - b);
  return angles;
}

export function generateLithopaneMesh(
  heightmap: Float32Array,
  resolution: number,
  diameterMm: number,
  numLayers: number,
  layerHeightMm: number,
  numNotches: number,
  notchRadiusMm: number,
  notchHeightMm: number,
  baseLayerHeightMm: number
): THREE.BufferGeometry {
  const radiusMm = diameterMm / 2;
  const baseHeight = baseLayerHeightMm; // minimum height for interior points
  const maxHeight = roundToPrecision(baseLayerHeightMm + (numLayers - 1) * layerHeightMm, 2);

  // Step A: Create PlaneGeometry — segments match heightmap resolution
  const segments = resolution - 1; // PlaneGeometry(w, h, segsX, segsY) creates (segsX+1) × (segsY+1) vertices
  const plane = new THREE.PlaneGeometry(diameterMm, diameterMm, segments, segments);

  // Step B: CPU displacement — modify position array directly
  const pos = plane.attributes.position as THREE.BufferAttribute;
  const count = pos.count;

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const r = Math.sqrt(x * x + y * y);

    if (r <= radiusMm) {
      // Map vertex (x, y) → heightmap pixel
      // PlaneGeometry ranges from -diameter/2 to +diameter/2
      const u = (x + radiusMm) / diameterMm; // 0–1
      const v = 1 - (y + radiusMm) / diameterMm; // 0–1, flipped for image coords

      const px = Math.min(Math.floor(u * resolution), resolution - 1);
      const py = Math.min(Math.floor(v * resolution), resolution - 1);
      const heightVal = heightmap[py * resolution + px];

      // Z = height from heightmap (already quantized to layer steps)
      // Ensure at least base height for interior pixels
      pos.setZ(i, heightVal > 0 ? heightVal : baseHeight);
    } else {
      // Exterior vertices: FOLD to circle perimeter at Z=0
      const theta = Math.atan2(y, x);
      pos.setX(i, radiusMm * Math.cos(theta));
      pos.setY(i, radiusMm * Math.sin(theta));
      pos.setZ(i, 0);
    }
  }
  pos.needsUpdate = true;

  // Step C: Bottom cap — CircleGeometry at Z=0, facing -Z
  const bottomCap = new THREE.CircleGeometry(radiusMm, Math.max(64, segments));
  // Flip normals to face downward
  const bottomPos = bottomCap.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < bottomPos.count; i++) {
    bottomPos.setZ(i, 0);
  }
  // Flip faces by reversing the index order
  const bottomIndex = bottomCap.index!;
  const idxArray = bottomIndex.array as Uint16Array | Uint32Array;
  for (let i = 0; i < idxArray.length; i += 3) {
    const tmp = idxArray[i];
    idxArray[i] = idxArray[i + 2];
    idxArray[i + 2] = tmp;
  }
  bottomIndex.needsUpdate = true;

  // Step D: Manifold fusion
  // Strip UVs and normals from all geometries before merging to avoid attribute mismatch
  plane.deleteAttribute('uv');
  plane.deleteAttribute('normal');
  bottomCap.deleteAttribute('uv');
  bottomCap.deleteAttribute('normal');

  const geometries: THREE.BufferGeometry[] = [plane, bottomCap];

  // Generate notches — placed intelligently near thicker rim areas
  if (numNotches > 0 && notchRadiusMm > 0) {
    const notchAngles = computeNotchAngles(heightmap, resolution, numNotches);
    for (const angle of notchAngles) {
      const notch = createSemicircularNotch(
        radiusMm,
        angle,
        notchRadiusMm,
        notchHeightMm
      );
      notch.deleteAttribute('uv');
      notch.deleteAttribute('normal');
      geometries.push(notch);
    }
  }

  // All geometries now have only 'position' attribute and are indexed.
  // mergeGeometries can merge indexed geometries directly — no need for
  // toNonIndexed() which inflates vertex count ~6x and makes mergeVertices slow.
  let merged = mergeGeometries(geometries, false);
  if (!merged) throw new Error('Failed to merge geometries');

  merged = mergeVertices(merged, 0.01); // tolerance in mm
  merged.computeVertexNormals();

  return merged;
}

/**
 * Create a semicircular notch (bump) on the rim.
 * Extends outward from the circle perimeter.
 */
function createSemicircularNotch(
  rimRadius: number,
  angle: number,
  notchRadius: number,
  height: number
): THREE.BufferGeometry {
  // The notch center sits on the rim, extending outward
  const cx = rimRadius * Math.cos(angle);
  const cy = rimRadius * Math.sin(angle);

  // Create a cylinder for the notch
  const segments = 16;
  const notch = new THREE.CylinderGeometry(notchRadius, notchRadius, height, segments);

  // CylinderGeometry is along Y axis; we need it along Z axis
  notch.rotateX(Math.PI / 2);

  // Position: center at rim, shifted outward by half the notch radius so it protrudes
  notch.translate(cx, cy, height / 2);

  return notch;
}
