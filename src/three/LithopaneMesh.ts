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
 * After greedy placement, ensures no gap exceeds a maximum angular span
 * so there are no totally unsupported areas.
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
  for (let i = 0; i < numSamples; i++) {
    weights[i] = 1 + rimHeights[i] * rimHeights[i];
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

  // Ensure no gap between consecutive notches exceeds the maximum allowed span.
  // Max gap = 1.8× the even spacing (so with 10 notches at 36° each, max ~65°).
  // Cap total notches at 1.5× requested to avoid runaway insertion.
  const maxGap = (2 * Math.PI / numNotches) * 1.8;
  const maxTotalNotches = Math.ceil(numNotches * 1.5);
  for (let safety = 0; safety < numNotches * 2 && angles.length < maxTotalNotches; safety++) {
    let worstGap = 0;
    let worstIdx = -1;
    for (let i = 0; i < angles.length; i++) {
      const next = (i + 1) % angles.length;
      let gap = angles[next] - angles[i];
      if (gap <= 0) gap += 2 * Math.PI; // wrap around
      if (gap > worstGap) {
        worstGap = gap;
        worstIdx = i;
      }
    }
    if (worstGap <= maxGap) break;
    // Split the largest gap by inserting a notch at its midpoint
    const next = (worstIdx + 1) % angles.length;
    let mid = (angles[worstIdx] + angles[next]) / 2;
    if (angles[next] <= angles[worstIdx]) mid = angles[worstIdx] + worstGap / 2;
    if (mid >= 2 * Math.PI) mid -= 2 * Math.PI;
    angles.push(mid);
    angles.sort((a, b) => a - b);
  }

  return angles;
}

export interface LithopaneGeometry {
  body: THREE.BufferGeometry;
  notches: THREE.BufferGeometry | null;
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
  baseLayerHeightMm: number,
  arachneOptimize = false,
  nozzleWidthMm = 0.4
): LithopaneGeometry {
  const radiusMm = diameterMm / 2;
  const baseHeight = baseLayerHeightMm; // minimum height for interior points

  // Arachne mode: use half-nozzle vertex spacing (~0.2mm).
  // Finer than slicer simplification threshold so contours are smooth,
  // but not so fine that mesh generation becomes slow.
  const defaultSpacing = diameterMm / (resolution - 1);
  const vertexSpacingMm = arachneOptimize
    ? Math.max(nozzleWidthMm / 2, 0.15)
    : defaultSpacing;
  const meshSegments = arachneOptimize
    ? Math.ceil(diameterMm / vertexSpacingMm)
    : resolution - 1;

  // Step A: Build vertex grid
  const gridSize = meshSegments + 1;
  const positions = new Float32Array(gridSize * gridSize * 3);
  const mmPerPixel = diameterMm / resolution;

  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const x = -radiusMm + gx * vertexSpacingMm;
      const y = radiusMm - gy * vertexSpacingMm;
      const r = Math.sqrt(x * x + y * y);
      const vi = (gy * gridSize + gx) * 3;

      if (r <= radiusMm) {
        const u = (x + radiusMm) / diameterMm;
        const v = 1 - (y + radiusMm) / diameterMm;

        // Bilinear sample from heightmap
        const fx = u * (resolution - 1);
        const fy = v * (resolution - 1);
        const ix = Math.min(Math.floor(fx), resolution - 2);
        const iy = Math.min(Math.floor(fy), resolution - 2);
        const dx = fx - ix;
        const dy = fy - iy;
        const h00 = heightmap[iy * resolution + ix];
        const h10 = heightmap[iy * resolution + ix + 1];
        const h01 = heightmap[(iy + 1) * resolution + ix];
        const h11 = heightmap[(iy + 1) * resolution + ix + 1];
        const heightVal = h00 * (1 - dx) * (1 - dy) + h10 * dx * (1 - dy)
                        + h01 * (1 - dx) * dy + h11 * dx * dy;

        positions[vi] = x;
        positions[vi + 1] = y;
        positions[vi + 2] = heightVal > 0 ? heightVal : baseHeight;
      } else {
        const theta = Math.atan2(y, x);
        positions[vi] = radiusMm * Math.cos(theta);
        positions[vi + 1] = radiusMm * Math.sin(theta);
        positions[vi + 2] = 0;
      }
    }
  }

  // Step B: Build index buffer with smart diagonal splitting
  // For each quad, split along the diagonal connecting the two vertices with
  // closest Z-heights to minimize artificial ridges.
  const indices: number[] = [];
  for (let gy = 0; gy < meshSegments; gy++) {
    for (let gx = 0; gx < meshSegments; gx++) {
      const a = gy * gridSize + gx;           // top-left
      const b = a + 1;                         // top-right
      const c = (gy + 1) * gridSize + gx;     // bottom-left
      const d = c + 1;                         // bottom-right

      if (arachneOptimize) {
        const zA = positions[a * 3 + 2];
        const zB = positions[b * 3 + 2];
        const zC = positions[c * 3 + 2];
        const zD = positions[d * 3 + 2];
        // Compare diagonals: A-D vs B-C — split along the shorter Z difference
        // Winding: CCW when viewed from +Z (front face)
        const diagAD = Math.abs(zA - zD);
        const diagBC = Math.abs(zB - zC);
        if (diagAD <= diagBC) {
          indices.push(a, d, b, a, c, d);
        } else {
          indices.push(a, c, b, b, c, d);
        }
      } else {
        // Default: consistent split (CCW winding)
        indices.push(a, d, b, a, c, d);
      }
    }
  }

  const plane = new THREE.BufferGeometry();
  plane.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  plane.setIndex(indices);

  // Step C: Bottom cap — CircleGeometry at Z=0, facing -Z
  const capSegments = Math.min(Math.max(64, meshSegments), 128);
  const bottomCap = new THREE.CircleGeometry(radiusMm, capSegments);
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

  // Generate notch geometry separately so it can be toggled in preview
  let notchGeometry: THREE.BufferGeometry | null = null;
  if (numNotches > 0 && notchRadiusMm > 0) {
    const notchAngles = computeNotchAngles(heightmap, resolution, numNotches);
    const notchParts: THREE.BufferGeometry[] = [];
    for (const angle of notchAngles) {
      const notch = createSemicircularNotch(
        radiusMm,
        angle,
        notchRadiusMm,
        notchHeightMm
      );
      notch.deleteAttribute('uv');
      notch.deleteAttribute('normal');
      notchParts.push(notch);
    }
    const mergedNotchesRaw = mergeGeometries(notchParts, false);
    for (const g of notchParts) g.dispose();
    if (mergedNotchesRaw) {
      const mergedNotches = mergeVertices(mergedNotchesRaw, 0.01);
      mergedNotchesRaw.dispose();
      mergedNotches.computeVertexNormals();
      notchGeometry = mergedNotches;
    }
  }

  // All geometries now have only 'position' attribute and are indexed.
  // mergeGeometries can merge indexed geometries directly — no need for
  // toNonIndexed() which inflates vertex count ~6x and makes mergeVertices slow.
  const mergedRaw = mergeGeometries(geometries, false);
  // Dispose all input geometries — their data has been copied into mergedRaw
  for (const g of geometries) g.dispose();
  if (!mergedRaw) throw new Error('Failed to merge geometries');

  const merged = mergeVertices(mergedRaw, 0.01); // tolerance in mm
  // Dispose the pre-mergeVertices intermediate
  mergedRaw.dispose();

  merged.computeVertexNormals();

  return { body: merged, notches: notchGeometry };
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
  // Notch center sits on the rim
  const cx = rimRadius * Math.cos(angle);
  const cy = rimRadius * Math.sin(angle);

  // Create a cylinder for the notch
  const segments = 16;
  const notch = new THREE.CylinderGeometry(notchRadius, notchRadius, height, segments);

  // CylinderGeometry is along Y axis; we need it along Z axis
  notch.rotateX(Math.PI / 2);

  notch.translate(cx, cy, height / 2);

  // Clip: project any vertices inside the image circle onto the rim
  // so the notch never intrudes into the image area.
  const pos = notch.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const dist = Math.sqrt(x * x + y * y);
    if (dist < rimRadius && dist > 0.001) {
      pos.setX(i, x * rimRadius / dist);
      pos.setY(i, y * rimRadius / dist);
    }
  }
  pos.needsUpdate = true;

  return notch;
}
