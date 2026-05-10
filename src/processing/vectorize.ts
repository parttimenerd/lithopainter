/**
 * Vectorization pipeline for lithopane generation.
 *
 * Instead of pixel-based dithering, this approach:
 * 1. Takes a high-resolution grayscale image
 * 2. For each layer threshold, creates a cumulative binary mask
 *    (each layer includes all layers above it — darker areas appear in every layer)
 * 3. Traces contour edges on each binary layer using marching squares
 * 4. Fits bezier curves to contours ensuring minimum nozzle-width lines
 * 5. Applies smoothing and removes features smaller than nozzle width
 * 6. Rasterizes the vector layers back to a high-resolution heightmap for mesh generation
 */

import { clamp, roundToPrecision } from '../utils/mathUtils';
import { getDefaultThresholds, computeAutoThresholds } from './imageProcessor';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Vec2 {
  x: number;
  y: number;
}

/** A cubic bezier segment */
export interface BezierSegment {
  p0: Vec2;
  cp1: Vec2;
  cp2: Vec2;
  p3: Vec2;
}

/** A closed contour represented as a chain of bezier curves */
export interface VectorContourPath {
  segments: BezierSegment[];
  /** Whether this is an outer boundary (true) or a hole (false) */
  isOuter: boolean;
  /** Approximate area in pixels² (absolute value) */
  area: number;
}

/** All contours for one binary layer */
export interface VectorizedLayer {
  /** Layer index (0 = base, N-1 = thickest) */
  index: number;
  /** The threshold used to binarize (0-1, luminance below this → filled) */
  threshold: number;
  /** Physical height in mm */
  heightMm: number;
  /** Vector contour paths */
  contours: VectorContourPath[];
}

export interface VectorizationResult {
  layers: VectorizedLayer[];
  /** High-resolution heightmap rasterized from vector layers */
  heightmap: Float32Array;
  /** Resolution of the heightmap (square) */
  resolution: number;
  /** Computed thresholds used */
  computedThresholds: number[];
}

export interface VectorizationParams {
  numLayers: number;
  layerHeightMm: number;
  baseLayerHeightMm: number;
  diameterMm: number;
  nozzleWidthMm: number;
  /** Smoothing iterations for contour simplification (0-10) */
  smoothing: number;
  /** Minimum feature size in nozzle widths (features smaller than this are removed) */
  minFeatureSize: number;
  /** Resolution multiplier for the output heightmap (1-4, default 2) */
  outputResolution: number;
  /** Custom thresholds (empty = auto) */
  thresholds: number[];
  autoThresholds: boolean;
  /** Edge feather for circular mask */
  edgeFeather: number;
  mirror: boolean;
  /** Fill enclosed regions as solid polygons; when false, only stroke contour edges */
  fillRegions: boolean;
  // Image adjustment params
  brightness: number;
  contrast: number;
  gamma: number;
  shadows: number;
  highlights: number;
  localContrast: number;
  edgeEnhance: number;
  autoLevels: boolean;
}

// ---------------------------------------------------------------------------
// Marching Squares Contour Tracing
// ---------------------------------------------------------------------------

/**
 * Trace contours on a binary image using pixel-boundary edge following.
 * Produces closed loops of pixel-coordinate points.
 * Uses directional preference at junctions to stay on the same boundary.
 */
function traceContours(binary: Uint8Array, width: number, height: number): Vec2[][] {
  const contours: Vec2[][] = [];

  // Build directed edge graph from pixel boundaries.
  // Each edge goes from (x1,y1) to (x2,y2) along a pixel boundary,
  // with filled region on the right side of the edge direction.

  // Pack edge endpoint into a single number for fast lookup
  const packPt = (x: number, y: number) => y * (width + 2) + x;

  // Store edges as: from → [array of {to, dx, dy}]
  // dx,dy = direction vector of the edge (unit step)
  interface DEdge { to: number; tx: number; ty: number; used: boolean; }
  const adjList = new Map<number, DEdge[]>();

  function addEdge(x1: number, y1: number, x2: number, y2: number) {
    const from = packPt(x1, y1);
    const edge: DEdge = { to: packPt(x2, y2), tx: x2 - x1, ty: y2 - y1, used: false };
    const list = adjList.get(from);
    if (list) list.push(edge);
    else adjList.set(from, [edge]);
  }

  // Scan for boundary edges
  for (let y = 0; y <= height; y++) {
    for (let x = 0; x < width; x++) {
      const above = y > 0 ? binary[(y - 1) * width + x] : 0;
      const below = y < height ? binary[y * width + x] : 0;
      if (above !== below) {
        if (below) {
          addEdge(x, y, x + 1, y); // filled below → left to right
        } else {
          addEdge(x + 1, y, x, y); // filled above → right to left
        }
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x <= width; x++) {
      const left = x > 0 ? binary[y * width + (x - 1)] : 0;
      const right = x < width ? binary[y * width + x] : 0;
      if (left !== right) {
        if (right) {
          addEdge(x, y + 1, x, y); // filled right → bottom to top
        } else {
          addEdge(x, y, x, y + 1); // filled left → top to bottom
        }
      }
    }
  }

  // Follow edges with "turn right" preference at junctions.
  // This keeps us on the outer boundary of a filled region.
  // At each vertex, pick the outgoing edge that turns rightmost
  // relative to our incoming direction.

  // Cross product: which way does (dx2,dy2) turn relative to (dx1,dy1)?
  // Positive = left turn, negative = right turn, 0 = straight
  function turnOrder(inDx: number, inDy: number, outDx: number, outDy: number): number {
    // We rank turns: right turn (best) → straight → left turn (worst) → U-turn
    // Use atan2 difference mapped to [0, 2π), lower = more rightward
    const inAngle = Math.atan2(inDy, inDx);
    const outAngle = Math.atan2(outDy, outDx);
    // Relative angle: how much we turn from incoming direction
    // We want the most-clockwise (rightward) turn = smallest positive relative angle
    let rel = inAngle - outAngle; // note: reversed because "right" in screen coords
    if (rel < 0) rel += 2 * Math.PI;
    if (rel >= 2 * Math.PI) rel -= 2 * Math.PI;
    return rel; // lower = more right turn
  }

  for (const [startFrom, edges] of adjList) {
    for (let ei = 0; ei < edges.length; ei++) {
      const startEdge = edges[ei];
      if (startEdge.used) continue;

      startEdge.used = true;
      const points: Vec2[] = [];
      const startX = startFrom % (width + 2);
      const startY = Math.floor(startFrom / (width + 2));
      points.push({ x: startX, y: startY });

      let currentTo = startEdge.to;
      let inDx = startEdge.tx;
      let inDy = startEdge.ty;
      let safety = 0;
      const maxIter = (width + height) * 4;

      while (safety++ < maxIter) {
        const toX = currentTo % (width + 2);
        const toY = Math.floor(currentTo / (width + 2));
        points.push({ x: toX, y: toY });

        // Check if we've returned to start
        if (currentTo === startFrom) break;

        // Find next edge: pick the one with best (smallest) turn order
        const nextEdges = adjList.get(currentTo);
        if (!nextEdges) break;

        let bestEdge: DEdge | null = null;
        let bestTurn = Infinity;
        for (const ne of nextEdges) {
          if (ne.used) continue;
          const t = turnOrder(inDx, inDy, ne.tx, ne.ty);
          if (t < bestTurn) {
            bestTurn = t;
            bestEdge = ne;
          }
        }

        if (!bestEdge) break;

        bestEdge.used = true;
        inDx = bestEdge.tx;
        inDy = bestEdge.ty;
        currentTo = bestEdge.to;
      }

      if (points.length >= 4) {
        contours.push(points);
      }
    }
  }

  return contours;
}

// ---------------------------------------------------------------------------
// Contour Simplification & Smoothing
// ---------------------------------------------------------------------------

/**
 * Remove collinear points from a polygon — these come from pixel boundaries
 * where multiple edges run in the same direction (horizontal/vertical runs).
 */
function removeCollinear(points: Vec2[]): Vec2[] {
  if (points.length < 3) return points;
  const result: Vec2[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    // Check if curr is collinear with prev and next
    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;
    // Cross product — if zero, points are collinear
    if (Math.abs(dx1 * dy2 - dy1 * dx2) > 1e-10) {
      result.push(curr);
    }
  }
  return result.length >= 3 ? result : points;
}

/**
 * Douglas-Peucker simplification.
 * Reduces point count while preserving shape within tolerance.
 */
function simplifyContour(points: Vec2[], tolerance: number): Vec2[] {
  if (points.length <= 3) return points;

  function perpDist(p: Vec2, a: Vec2, b: Vec2): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
    const projX = a.x + t * dx;
    const projY = a.y + t * dy;
    return Math.hypot(p.x - projX, p.y - projY);
  }

  function simplifyRange(start: number, end: number, keep: boolean[]): void {
    let maxDist = 0;
    let maxIdx = start;
    for (let i = start + 1; i < end; i++) {
      const d = perpDist(points[i], points[start], points[end]);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > tolerance) {
      keep[maxIdx] = true;
      simplifyRange(start, maxIdx, keep);
      simplifyRange(maxIdx, end, keep);
    }
  }

  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  simplifyRange(0, points.length - 1, keep);

  return points.filter((_, i) => keep[i]);
}

/**
 * Chaikin's corner cutting — smooths a closed polygon.
 * Each iteration replaces each edge midpoints with quarter-points.
 */
function smoothContour(points: Vec2[], iterations: number): Vec2[] {
  if (points.length < 3 || iterations <= 0) return points;

  let current = points;
  for (let iter = 0; iter < iterations; iter++) {
    const next: Vec2[] = [];
    const n = current.length;
    for (let i = 0; i < n; i++) {
      const p0 = current[i];
      const p1 = current[(i + 1) % n];
      // Quarter point (closer to p0)
      next.push({ x: 0.75 * p0.x + 0.25 * p1.x, y: 0.75 * p0.y + 0.25 * p1.y });
      // Three-quarter point (closer to p1)
      next.push({ x: 0.25 * p0.x + 0.75 * p1.x, y: 0.25 * p0.y + 0.75 * p1.y });
    }
    current = next;
  }
  return current;
}

// ---------------------------------------------------------------------------
// Bezier Curve Fitting
// ---------------------------------------------------------------------------

/**
 * Fit cubic bezier segments to a closed polyline using Catmull-Rom tangents.
 * Every consecutive pair of points becomes one segment with smooth tangents
 * derived from neighboring points.
 */
function fitBeziers(points: Vec2[]): BezierSegment[] {
  const n = points.length;
  if (n < 2) return [];
  if (n === 2) {
    const p0 = points[0], p1 = points[1];
    return [{
      p0, p3: p1,
      cp1: { x: p0.x + (p1.x - p0.x) / 3, y: p0.y + (p1.y - p0.y) / 3 },
      cp2: { x: p0.x + 2 * (p1.x - p0.x) / 3, y: p0.y + 2 * (p1.y - p0.y) / 3 },
    }];
  }

  const segments: BezierSegment[] = [];
  // Catmull-Rom → Bezier conversion for a closed loop:
  // For each segment i→i+1, tangent at i uses points[i-1] and points[i+1],
  // tangent at i+1 uses points[i] and points[i+2].
  const tension = 0.4; // 0 = straight lines, 0.5 = full Catmull-Rom

  for (let i = 0; i < n; i++) {
    const i0 = i;
    const i1 = (i + 1) % n;
    const iPrev = (i - 1 + n) % n;
    const iNext = (i + 2) % n;

    const p0 = points[i0];
    const p1 = points[i1];

    // Tangent at p0 (using prev and next point)
    const t0x = (points[i1].x - points[iPrev].x) * tension;
    const t0y = (points[i1].y - points[iPrev].y) * tension;

    // Tangent at p1 (using current and next-next point)
    const t1x = (points[iNext].x - points[i0].x) * tension;
    const t1y = (points[iNext].y - points[i0].y) * tension;

    segments.push({
      p0,
      cp1: { x: p0.x + t0x / 3, y: p0.y + t0y / 3 },
      cp2: { x: p1.x - t1x / 3, y: p1.y - t1y / 3 },
      p3: p1,
    });
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Minimum Width Enforcement
// ---------------------------------------------------------------------------

/**
 * Compute the signed area of a closed polygon (shoelace formula).
 * Positive = CCW (outer), Negative = CW (hole).
 */
function polygonArea(points: Vec2[]): number {
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return area / 2;
}

/**
 * Compute perimeter of a closed polygon.
 */
function polygonPerimeter(points: Vec2[]): number {
  let perim = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    perim += Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y);
  }
  return perim;
}

/**
 * Dilate a contour outward by `amount` pixels using simple normal offsetting.
 * For thin features, this ensures they meet minimum nozzle width.
 */
function offsetContour(points: Vec2[], amount: number): Vec2[] {
  if (points.length < 3 || amount === 0) return points;

  const n = points.length;
  const result: Vec2[] = [];

  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];

    // Edge normals (pointing outward for CCW contour)
    const e1x = curr.x - prev.x;
    const e1y = curr.y - prev.y;
    const e2x = next.x - curr.x;
    const e2y = next.y - curr.y;

    const len1 = Math.hypot(e1x, e1y) || 1;
    const len2 = Math.hypot(e2x, e2y) || 1;

    // Outward normals (rotate 90° CCW)
    const n1x = -e1y / len1;
    const n1y = e1x / len1;
    const n2x = -e2y / len2;
    const n2y = e2x / len2;

    // Average normal at vertex
    const nx = (n1x + n2x) / 2;
    const ny = (n1y + n2y) / 2;
    const nLen = Math.hypot(nx, ny) || 1;

    result.push({
      x: curr.x + (nx / nLen) * amount,
      y: curr.y + (ny / nLen) * amount,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main Vectorization Pipeline
// ---------------------------------------------------------------------------

/**
 * Apply image adjustments (same as imageProcessor but extracted for clarity).
 * Returns processed grayscale buffer.
 */
function applyImageAdjustments(
  lum: Uint8Array,
  width: number,
  height: number,
  params: VectorizationParams
): Uint8Array {
  // Import inline to avoid circular — we reuse the functions from imageProcessor
  // Actually they're already exported, we import at top
  let processed = lum;

  // We apply adjustments manually here since we need the intermediate grayscale
  // Brightness & contrast
  if (params.brightness !== 0 || params.contrast !== 0) {
    const out = new Uint8Array(width * height);
    const factor = 1 + params.contrast;
    for (let i = 0; i < processed.length; i++) {
      let v = processed[i] / 255;
      v = (v - 0.5) * factor + 0.5 + params.brightness;
      out[i] = clamp(Math.round(v * 255), 0, 255);
    }
    processed = out;
  }

  // Gamma
  if (params.gamma !== 1.0) {
    const out = new Uint8Array(width * height);
    const invGamma = 1 / params.gamma;
    for (let i = 0; i < processed.length; i++) {
      out[i] = clamp(Math.round(Math.pow(processed[i] / 255, invGamma) * 255), 0, 255);
    }
    processed = out;
  }

  // Shadows & highlights
  if (params.shadows !== 0 || params.highlights !== 0) {
    const out = new Uint8Array(width * height);
    for (let i = 0; i < processed.length; i++) {
      let v = processed[i] / 255;
      // Shadows: lift/crush dark areas
      if (params.shadows > 0) {
        v = v + params.shadows * (1 - v) * (1 - v) * 0.5;
      } else {
        v = v + params.shadows * v * (1 - v) * 0.5;
      }
      // Highlights: boost/reduce bright areas
      if (params.highlights > 0) {
        v = v + params.highlights * v * v * 0.5;
      } else {
        v = v + params.highlights * v * (1 - v) * 0.5;
      }
      out[i] = clamp(Math.round(v * 255), 0, 255);
    }
    processed = out;
  }

  return processed;
}

/**
 * Vectorize a source image into layered bezier contours, then rasterize
 * to a high-resolution heightmap.
 *
 * Each layer is a cumulative binary mask: layer[i] includes all filled
 * areas from layers above it (i+1, i+2, ..., N-1). The darkest parts
 * of the image appear in ALL layers.
 */
export function vectorizeImage(
  source: HTMLCanvasElement | HTMLImageElement,
  params: VectorizationParams
): VectorizationResult {
  const {
    numLayers,
    layerHeightMm,
    baseLayerHeightMm,
    diameterMm,
    nozzleWidthMm,
    smoothing,
    minFeatureSize,
    outputResolution,
    thresholds: customThresholds,
    autoThresholds,
    edgeFeather,
    mirror,
  } = params;

  // Step 1: Get grayscale at reasonable resolution for edge detection
  // 2× nozzle resolution for clean edges, cap at 500 for speed
  const traceRes = Math.min(Math.ceil(diameterMm / nozzleWidthMm * 2), 500);
  const canvas = document.createElement('canvas');
  canvas.width = traceRes;
  canvas.height = traceRes;
  const ctx = canvas.getContext('2d')!;

  // Mirror if needed
  if (mirror) {
    ctx.translate(traceRes, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, 0, 0, traceRes, traceRes);

  const imgData = ctx.getImageData(0, 0, traceRes, traceRes);
  const lum = new Uint8Array(traceRes * traceRes);
  const bgMask = new Uint8Array(traceRes * traceRes);

  for (let i = 0; i < lum.length; i++) {
    const r = imgData.data[i * 4];
    const g = imgData.data[i * 4 + 1];
    const b = imgData.data[i * 4 + 2];
    const a = imgData.data[i * 4 + 3];
    if (a < 10) {
      lum[i] = 255;
      bgMask[i] = 1;
    } else {
      lum[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      bgMask[i] = 0;
    }
  }

  // Step 2: Apply image adjustments
  const processed = applyImageAdjustments(lum, traceRes, traceRes, params);

  // Step 3: Compute thresholds
  // For vectorization, thresholds define which luminance levels belong to each cumulative layer
  // Invert luminance: dark = filled (thick), light = empty (thin)
  const inverted = new Uint8Array(traceRes * traceRes);
  for (let i = 0; i < processed.length; i++) {
    inverted[i] = 255 - processed[i];
  }

  let layerThresholds: number[];
  const levels = numLayers - 1;
  if (customThresholds.length === levels) {
    layerThresholds = customThresholds;
  } else if (autoThresholds) {
    layerThresholds = computeAutoThresholds(processed, numLayers, bgMask);
  } else {
    layerThresholds = getDefaultThresholds(numLayers);
  }

  // Step 4: For each threshold, create binary mask and trace contours
  // Layer i is filled where inverted luminance >= threshold[i]
  // (layer 0 = base has everything, layer N-1 = top has only darkest)
  // Since layers are cumulative upward, layer[i] = { pixels where value >= thresh[i-1] }
  // Layer 0: everything inside circle (base)
  // Layer 1: inverted >= thresh[0]
  // Layer 2: inverted >= thresh[1]
  // etc.
  const minFeaturePx = minFeatureSize * (traceRes / (diameterMm / nozzleWidthMm));
  const minAreaPx = Math.PI * (minFeaturePx / 2) * (minFeaturePx / 2);

  // Apply circular mask to know what's "inside"
  const centerPx = traceRes / 2;
  const radiusPx = traceRes / 2 - 1;

  const layers: VectorizedLayer[] = [];

  for (let layerIdx = 1; layerIdx < numLayers; layerIdx++) {
    // This layer includes everything darker than this threshold
    // Threshold is in [0,1], inverted luminance is [0,255]
    const thresh = layerThresholds[layerIdx - 1] * 255;

    // Create binary mask: 1 where this layer should have material
    const binary = new Uint8Array(traceRes * traceRes);
    for (let i = 0; i < binary.length; i++) {
      // Must be inside circle and not background
      const px = i % traceRes;
      const py = Math.floor(i / traceRes);
      const dx = px - centerPx;
      const dy = py - centerPx;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radiusPx) continue;
      if (bgMask[i] === 1) continue;

      if (inverted[i] >= thresh) {
        binary[i] = 1;
      }
    }

    // Step 5: Trace contours
    const rawContours = traceContours(binary, traceRes, traceRes);

    // Step 6: Process each contour
    const vectorContours: VectorContourPath[] = [];

    for (const rawPts of rawContours) {
      // Compute area to determine if outer or hole
      const area = polygonArea(rawPts);
      const absArea = Math.abs(area);

      // Filter out tiny features
      if (absArea < minAreaPx) continue;

      // Filter out features with too-small width
      // Approximate width = area / (perimeter/2)
      const perim = polygonPerimeter(rawPts);
      const approxWidth = perim > 0 ? (2 * absArea) / perim : 0;
      if (approxWidth < minFeaturePx * 0.3) {
        // Very thin feature — check if we should thicken it or skip
        // If it's still above half minimum, keep it (will be thickened)
        if (approxWidth < minFeaturePx * 0.1) continue;
      }

      // Remove collinear staircase points first
      let simplified = removeCollinear(rawPts);

      // Simplify (Douglas-Peucker) — tolerance based on nozzle width
      const simplifyTol = nozzleWidthMm * 0.3 * (traceRes / diameterMm);
      simplified = simplifyContour(simplified, simplifyTol);

      // Smooth (Chaikin)
      const smoothIters = Math.round(smoothing * 2);
      simplified = smoothContour(simplified, smoothIters);

      // Ensure minimum width by offsetting thin contours outward
      if (approxWidth < minFeaturePx && area > 0) {
        const deficit = (minFeaturePx - approxWidth) / 2;
        simplified = offsetContour(simplified, deficit);
      }

      // Fit bezier curves
      const segments = fitBeziers(simplified);

      vectorContours.push({
        segments,
        isOuter: area > 0,
        area: absArea,
      });
    }

    const heightMm = baseLayerHeightMm + layerIdx * layerHeightMm;

    layers.push({
      index: layerIdx,
      threshold: layerThresholds[layerIdx - 1],
      heightMm,
      contours: vectorContours,
    });
  }

  // Step 7: Rasterize vector layers to heightmap
  // Scanline fill is O(n) per row so we can afford higher resolution
  const outRes = Math.min(
    Math.ceil(diameterMm / nozzleWidthMm * outputResolution),
    1500
  );
  const heightmap = rasterizeVectorLayers(
    layers, outRes, traceRes, numLayers, layerHeightMm, baseLayerHeightMm,
    diameterMm, edgeFeather, bgMask, traceRes, nozzleWidthMm, params.fillRegions
  );

  return {
    layers,
    heightmap,
    resolution: outRes,
    computedThresholds: layerThresholds,
  };
}

// ---------------------------------------------------------------------------
// Rasterization: Vector Layers → High-Res Heightmap
// ---------------------------------------------------------------------------

/**
 * Sample a cubic bezier at parameter t.
 */
function sampleBezier(seg: BezierSegment, t: number): Vec2 {
  const t2 = t * t;
  const t3 = t2 * t;
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  return {
    x: mt3 * seg.p0.x + 3 * mt2 * t * seg.cp1.x + 3 * mt * t2 * seg.cp2.x + t3 * seg.p3.x,
    y: mt3 * seg.p0.y + 3 * mt2 * t * seg.cp1.y + 3 * mt * t2 * seg.cp2.y + t3 * seg.p3.y,
  };
}

/**
 * Convert bezier contour to a dense polyline for rasterization.
 * Uses adaptive sampling — longer segments get more samples for smooth curves.
 */
function contourToPolyline(contour: VectorContourPath, scale: number): Vec2[] {
  const points: Vec2[] = [];
  for (const seg of contour.segments) {
    // Estimate arc length in output pixels using chord + control polygon
    const chordLen = Math.hypot(
      (seg.p3.x - seg.p0.x) * scale,
      (seg.p3.y - seg.p0.y) * scale
    );
    const ctrlLen = (
      Math.hypot((seg.cp1.x - seg.p0.x) * scale, (seg.cp1.y - seg.p0.y) * scale) +
      Math.hypot((seg.cp2.x - seg.cp1.x) * scale, (seg.cp2.y - seg.cp1.y) * scale) +
      Math.hypot((seg.p3.x - seg.cp2.x) * scale, (seg.p3.y - seg.cp2.y) * scale)
    );
    const approxLen = (chordLen + ctrlLen) / 2;
    // ~1 sample per 2 output pixels, minimum 4 per segment
    const samples = Math.max(4, Math.ceil(approxLen / 2));
    for (let i = 0; i < samples; i++) {
      const t = i / samples;
      points.push(sampleBezier(seg, t));
    }
  }
  return points;
}

/**
 * Test if a point is inside a polygon using ray casting.
 */
function pointInPolygon(px: number, py: number, polygon: Vec2[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if ((yi > py) !== (yj > py) &&
        px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Scanline fill: compute sorted X intersections of a polygon for a given Y.
 * Returns sorted array of X coordinates where the scanline crosses polygon edges.
 */
function scanlineIntersections(polygon: Vec2[], y: number): number[] {
  const xs: number[] = [];
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = polygon[i].y, yj = polygon[j].y;
    if ((yi <= y && yj > y) || (yj <= y && yi > y)) {
      const xi = polygon[i].x + (y - yi) / (yj - yi) * (polygon[j].x - polygon[i].x);
      xs.push(xi);
    }
  }
  xs.sort((a, b) => a - b);
  return xs;
}

/**
 * Rasterize all vector layers into a heightmap.
 * When fillRegions is true: fills enclosed polygon interiors using scanline fill,
 * properly subtracting holes.
 * When fillRegions is false: strokes only along contour edges at nozzle width.
 */
function rasterizeVectorLayers(
  layers: VectorizedLayer[],
  outRes: number,
  traceRes: number,
  numLayers: number,
  layerHeightMm: number,
  baseLayerHeightMm: number,
  diameterMm: number,
  edgeFeather: number,
  bgMask: Uint8Array,
  bgMaskRes: number,
  nozzleWidthMm: number,
  fillRegions: boolean
): Float32Array {
  const heightmap = new Float32Array(outRes * outRes);

  // Scale factor from trace resolution to output resolution
  const scale = outRes / traceRes;
  const centerOut = outRes / 2;
  const radiusOut = outRes / 2 - 1;
  const radiusOutSq = radiusOut * radiusOut;

  // Initialize: base layer height for everything inside circle
  for (let y = 0; y < outRes; y++) {
    const dy = y - centerOut;
    const dySq = dy * dy;
    for (let x = 0; x < outRes; x++) {
      const dx = x - centerOut;
      if (dx * dx + dySq > radiusOutSq) continue;
      // Check if BG pixel (sample from bgMask at appropriate scale)
      const bgX = Math.round(x / scale);
      const bgY = Math.round(y / scale);
      if (bgX >= 0 && bgX < bgMaskRes && bgY >= 0 && bgY < bgMaskRes &&
          bgMask[bgY * bgMaskRes + bgX] === 1) {
        heightmap[y * outRes + x] = roundToPrecision(0.5 * baseLayerHeightMm, 2);
      } else {
        heightmap[y * outRes + x] = baseLayerHeightMm;
      }
    }
  }

  const layerHeight = roundToPrecision(layerHeightMm, 2); // avoid repeated rounding

  // For each layer (from bottom to top), rasterize contours
  for (const layer of layers) {
    const h = roundToPrecision(layer.heightMm, 2);

    // Convert all contours to scaled polylines (fewer samples for speed)
    const outerPolygons: Vec2[][] = [];
    const holePolygons: Vec2[][] = [];

    for (const contour of layer.contours) {
      const poly = contourToPolyline(contour, scale);
      const scaled = poly.map(p => ({ x: p.x * scale, y: p.y * scale }));
      if (contour.isOuter) {
        outerPolygons.push(scaled);
      } else {
        holePolygons.push(scaled);
      }
    }

    if (fillRegions) {
      // FILL MODE: scanline fill for speed.
      // Associate each hole with its containing outer polygon.
      for (const polygon of outerPolygons) {
        if (polygon.length < 3) continue;

        // Find holes contained within this outer polygon
        const myHoles: Vec2[][] = [];
        for (const hole of holePolygons) {
          if (hole.length < 3) continue;
          if (pointInPolygon(hole[0].x, hole[0].y, polygon)) {
            myHoles.push(hole);
          }
        }

        // Compute bounding box
        let minY = Infinity, maxY = -Infinity;
        for (const p of polygon) {
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }

        const y0 = Math.max(0, Math.floor(minY));
        const y1 = Math.min(outRes - 1, Math.ceil(maxY));

        for (let y = y0; y <= y1; y++) {
          const dy = y - centerOut;
          const dySq = dy * dy;
          const scanY = y + 0.5;

          // Get outer polygon X intersections
          const outerXs = scanlineIntersections(polygon, scanY);

          // Get hole X intersections for subtraction
          const holeXArrays = myHoles.map(hole => scanlineIntersections(hole, scanY));

          // Fill between pairs of intersections (even-odd rule)
          for (let i = 0; i < outerXs.length - 1; i += 2) {
            const xStart = Math.max(0, Math.ceil(outerXs[i]));
            const xEnd = Math.min(outRes - 1, Math.floor(outerXs[i + 1]));

            for (let x = xStart; x <= xEnd; x++) {
              const dx = x - centerOut;
              if (dx * dx + dySq > radiusOutSq) continue;

              // Check if inside any hole (scanline even-odd)
              let inHole = false;
              for (const holeXs of holeXArrays) {
                let crossings = 0;
                for (let hi = 0; hi < holeXs.length; hi++) {
                  if (holeXs[hi] <= x + 0.5) crossings++;
                  else break;
                }
                if (crossings & 1) { inHole = true; break; }
              }

              if (!inHole) {
                const idx = y * outRes + x;
                if (heightmap[idx] < h) heightmap[idx] = h;
              }
            }
          }
        }
      }
    } else {
      // STROKE MODE: rasterize nozzle-width strokes along edges using Bresenham-style
      const strokeWidthPx = (nozzleWidthMm / diameterMm) * outRes;
      const halfStroke = Math.ceil(strokeWidthPx / 2);
      const halfStrokeSq = (strokeWidthPx / 2) * (strokeWidthPx / 2);

      const allPolygons = [...outerPolygons, ...holePolygons];
      for (const polygon of allPolygons) {
        if (polygon.length < 2) continue;
        const n = polygon.length;

        // For each edge, stamp pixels along it
        for (let i = 0, j = n - 1; i < n; j = i++) {
          const ax = polygon[j].x, ay = polygon[j].y;
          const bx = polygon[i].x, by = polygon[i].y;
          const edgeLen = Math.hypot(bx - ax, by - ay);
          if (edgeLen < 0.01) continue;

          // Walk along edge in ~1px steps
          const steps = Math.ceil(edgeLen);
          for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const cx = ax + t * (bx - ax);
            const cy = ay + t * (by - ay);

            // Stamp a square kernel around this point
            const px0 = Math.max(0, Math.floor(cx - halfStroke));
            const py0 = Math.max(0, Math.floor(cy - halfStroke));
            const px1 = Math.min(outRes - 1, Math.ceil(cx + halfStroke));
            const py1 = Math.min(outRes - 1, Math.ceil(cy + halfStroke));

            for (let py = py0; py <= py1; py++) {
              const dyc = py + 0.5 - cy;
              for (let px = px0; px <= px1; px++) {
                const dxc = px + 0.5 - cx;
                if (dxc * dxc + dyc * dyc > halfStrokeSq) continue;
                const dxo = px - centerOut;
                const dyo = py - centerOut;
                if (dxo * dxo + dyo * dyo > radiusOutSq) continue;
                const idx = py * outRes + px;
                if (heightmap[idx] < h) heightmap[idx] = h;
              }
            }
          }
        }
      }
    }
  }

  // Apply circular edge feather
  if (edgeFeather > 0) {
    const featherPx = edgeFeather * radiusOut * 0.3;
    const innerR = radiusOut - featherPx;
    for (let y = 0; y < outRes; y++) {
      const dy = y - centerOut;
      for (let x = 0; x < outRes; x++) {
        const dx = x - centerOut;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > innerR && dist <= radiusOut) {
          const t = (dist - innerR) / featherPx;
          const idx = y * outRes + x;
          heightmap[idx] = heightmap[idx] * (1 - t) + baseLayerHeightMm * t;
        }
      }
    }
  }

  // Set outside circle to 0
  for (let y = 0; y < outRes; y++) {
    const dy = y - centerOut;
    const dySq = dy * dy;
    for (let x = 0; x < outRes; x++) {
      const dx = x - centerOut;
      if (dx * dx + dySq > radiusOutSq) {
        heightmap[y * outRes + x] = 0;
      }
    }
  }

  return heightmap;
}
