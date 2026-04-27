import { BLUE_NOISE_16, roundToPrecision, clamp } from '../utils/mathUtils';
import type { DitherMethod } from '../types';

/**
 * Compute default evenly-spaced thresholds for N layers.
 * With N layers (levels = N-1), thresholds are at (i+0.5)/levels for i=0..levels-1.
 * Returns N-1 values in [0,1].
 */
export function getDefaultThresholds(numLayers: number): number[] {
  const levels = numLayers - 1;
  if (levels <= 0) return [];
  const t: number[] = [];
  for (let i = 0; i < levels; i++) {
    t.push((i + 0.5) / levels);
  }
  return t;
}

/**
 * Compute optimal thresholds from image histogram using multi-level Otsu's method.
 * Maximizes between-class variance to find the N-1 luminance boundaries that best
 * separate the image into N distinct tonal groups.
 * `luminance` should be the final processed (inverted) pixel data.
 * Returns N-1 sorted thresholds in [0, 1].
 */
export function computeAutoThresholds(
  luminance: Uint8Array,
  numLayers: number,
  bgMask?: Uint8Array
): number[] {
  const levels = numLayers - 1;
  if (levels <= 0) return [];

  // Build histogram of inverted luminance (0=thin, 1=thick) — foreground only
  const bins = 256;
  const hist = new Float64Array(bins);
  let total = 0;
  for (let i = 0; i < luminance.length; i++) {
    if (bgMask && bgMask[i] === 1) continue;
    const inv = 255 - luminance[i]; // invert: dark→high
    hist[inv]++;
    total++;
  }
  if (total === 0) return getDefaultThresholds(numLayers);

  // Normalize
  for (let i = 0; i < bins; i++) hist[i] /= total;

  // For small numbers of thresholds (≤4), use exhaustive search.
  // For more, use recursive bisection (much faster).
  if (levels <= 4) {
    return otsuExhaustive(hist, levels);
  } else {
    return otsuRecursive(hist, levels);
  }
}

/** Exhaustive multi-Otsu: maximize between-class variance for up to 4 thresholds. */
function otsuExhaustive(hist: Float64Array, numThresholds: number): number[] {
  const bins = hist.length;
  // Precompute cumulative sums
  const P = new Float64Array(bins + 1); // cumulative probability
  const S = new Float64Array(bins + 1); // cumulative mean
  for (let i = 0; i < bins; i++) {
    P[i + 1] = P[i] + hist[i];
    S[i + 1] = S[i] + (i / 255) * hist[i];
  }
  const totalMean = S[bins];

  // Between-class variance for a set of thresholds (bin indices)
  function bcv(thresholds: number[]): number {
    let variance = 0;
    let prevT = 0;
    const all = [...thresholds, bins];
    for (const t of all) {
      const w = P[t] - P[prevT];
      if (w > 1e-10) {
        const mu = (S[t] - S[prevT]) / w;
        variance += w * (mu - totalMean) * (mu - totalMean);
      }
      prevT = t;
    }
    return variance;
  }

  // Search with step size to keep it fast (~O(step^numThresholds))
  const step = Math.max(1, Math.floor(bins / 64));
  let bestBcv = -1;
  let bestThresholds: number[] = [];

  function search(depth: number, start: number, current: number[]) {
    if (depth === numThresholds) {
      const v = bcv(current);
      if (v > bestBcv) {
        bestBcv = v;
        bestThresholds = [...current];
      }
      return;
    }
    for (let i = start; i < bins - (numThresholds - depth) * step; i += step) {
      current.push(i);
      search(depth + 1, i + step, current);
      current.pop();
    }
  }

  search(0, step, []);

  // Convert bin indices to [0, 1]
  return bestThresholds.map(b => b / 255);
}

/** Recursive bisection Otsu for larger threshold counts. */
function otsuRecursive(hist: Float64Array, numThresholds: number): number[] {
  const bins = hist.length;

  function otsu2(lo: number, hi: number): number {
    // Find single best threshold in range [lo, hi)
    let P0 = 0, S0 = 0;
    let totalP = 0, totalS = 0;
    for (let i = lo; i < hi; i++) {
      totalP += hist[i];
      totalS += (i / 255) * hist[i];
    }
    if (totalP < 1e-10) return Math.floor((lo + hi) / 2);

    let bestT = lo;
    let bestBcv = -1;
    for (let t = lo + 1; t < hi; t++) {
      P0 += hist[t - 1];
      S0 += ((t - 1) / 255) * hist[t - 1];
      const P1 = totalP - P0;
      if (P0 < 1e-10 || P1 < 1e-10) continue;
      const mu0 = S0 / P0;
      const mu1 = (totalS - S0) / P1;
      const diff = mu0 - mu1;
      const v = P0 * P1 * diff * diff;
      if (v > bestBcv) {
        bestBcv = v;
        bestT = t;
      }
    }
    return bestT;
  }

  function bisect(lo: number, hi: number, n: number): number[] {
    if (n <= 0) return [];
    if (n === 1) return [otsu2(lo, hi)];
    const mid = otsu2(lo, hi);
    const leftCount = Math.floor((n - 1) / 2);
    const rightCount = n - 1 - leftCount;
    const left = bisect(lo, mid, leftCount);
    const right = bisect(mid, hi, rightCount);
    return [...left, mid, ...right];
  }

  const result = bisect(0, bins, numThresholds);
  result.sort((a, b) => a - b);
  return result.map(b => b / 255);
}

/**
 * Map inverted luminance (0–1) to a layer level using threshold cutpoints.
 * thresholds must be sorted ascending, length = numLayers - 1.
 */
function levelFromThresholds(value: number, thresholds: number[]): number {
  for (let i = 0; i < thresholds.length; i++) {
    if (value < thresholds[i]) return i;
  }
  return thresholds.length;
}

// Reusable canvases to avoid GPU-backed canvas accumulation across regenerations
let _downsampleCanvas: HTMLCanvasElement | null = null;
let _mirrorCanvas: HTMLCanvasElement | null = null;

/**
 * Downsample a source to the physical print resolution.
 * Resolution = diameterMm / nozzleWidthMm (e.g. 50/0.4 = 125 pixels).
 */
export function downsampleToCanvas(
  source: HTMLCanvasElement | HTMLImageElement,
  diameterMm: number,
  nozzleWidthMm: number
): HTMLCanvasElement {
  const res = Math.min(Math.ceil(diameterMm / nozzleWidthMm), 500);
  if (!_downsampleCanvas) _downsampleCanvas = document.createElement('canvas');
  _downsampleCanvas.width = res;
  _downsampleCanvas.height = res;
  const ctx = _downsampleCanvas.getContext('2d')!;
  // Clear before drawing so transparent pixels from BG-removed images
  // aren't composited onto stale opaque data from a prior frame.
  ctx.clearRect(0, 0, res, res);
  ctx.drawImage(source, 0, 0, res, res);
  return _downsampleCanvas;
}

/**
 * Convert canvas to grayscale luminance array and background mask.
 * Uses standard ITU-R BT.601 weighting.
 * Returns { lum, bgMask } where bgMask[i] = true for transparent/background pixels.
 */
export function toGrayscale(canvas: HTMLCanvasElement): { lum: Uint8Array; bgMask: Uint8Array } {
  const ctx = canvas.getContext('2d')!;
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const lum = new Uint8Array(width * height);
  const bgMask = new Uint8Array(width * height); // 1 = background, 0 = foreground
  for (let i = 0; i < lum.length; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3];
    // If alpha is 0 (removed background), mark as BG and treat as white
    if (a < 10) {
      lum[i] = 255;
      bgMask[i] = 1;
    } else {
      lum[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      bgMask[i] = 0;
    }
  }
  return { lum, bgMask };
}

/**
 * Edge-preserving bilateral blur (3×3 spatial kernel).
 * Blurs flat areas to suppress noise/dither flicker while preserving
 * sharp luminance edges. Neighbors with large intensity differences
 * are down-weighted via a range Gaussian.
 */
export function applyGaussianBlur(
  data: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const out = new Uint8Array(width * height);
  // Spatial weights: 3×3 Gaussian
  const sw = [
    0.0625, 0.125, 0.0625,
    0.125,  0.25,  0.125,
    0.0625, 0.125, 0.0625,
  ];
  // Range sigma: how much intensity difference is tolerated before reducing weight.
  // ~30/255 means edges with >~60 luma difference are strongly preserved.
  const rangeSigma = 30;
  const rangeDenom = -1 / (2 * rangeSigma * rangeSigma);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const center = data[idx];
      let sumW = 0;
      let sumV = 0;
      let ki = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const sy = clamp(y + dy, 0, height - 1);
        for (let dx = -1; dx <= 1; dx++) {
          const sx = clamp(x + dx, 0, width - 1);
          const val = data[sy * width + sx];
          const diff = val - center;
          const rangeW = Math.exp(diff * diff * rangeDenom);
          const w = sw[ki++] * rangeW;
          sumW += w;
          sumV += val * w;
        }
      }
      out[idx] = clamp(Math.round(sumV / sumW), 0, 255);
    }
  }
  return out;
}

/**
 * Bayer matrix ordered dithering.
 * Quantizes luminance into discrete layer heights.
 * Returns Float32Array of height values in mm.
 *
 * When bgMask is provided (from background removal):
 *   - Background pixels → half a layer height (thinner than any foreground)
 *   - Foreground pixels → layers 1..numLayers (full tonal range)
 * Without bgMask:
 *   - All pixels → layers 1..numLayers as before
 *
 * For lithopanes: dark = thick (high Z, blocks light), bright = thin (low Z, transmits light).
 */
export function bayerDither(
  luminance: Uint8Array,
  width: number,
  height: number,
  numLayers: number,
  layerHeightMm: number,
  baseLayerHeightMm: number,
  bgMask?: Uint8Array,
  dithering = 1.0,
  thresholds?: number[],
  reserveLayerForBg = true
): Float32Array {
  const heights = new Float32Array(width * height);
  const hasBg = bgMask && bgMask.some((v) => v === 1);

  const levels = numLayers - 1;
  const t = thresholds && thresholds.length === levels ? thresholds : getDefaultThresholds(numLayers);

  // Precompute edge strength map (Sobel gradient magnitude) to reduce
  // dithering at strong luminance edges, preserving sharp transitions.
  const edgeStrength = new Float32Array(width * height);
  if (dithering > 0) {
    let maxEdge = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        // Sobel X
        const gx = -luminance[(y - 1) * width + (x - 1)] - 2 * luminance[y * width + (x - 1)] - luminance[(y + 1) * width + (x - 1)]
                  + luminance[(y - 1) * width + (x + 1)] + 2 * luminance[y * width + (x + 1)] + luminance[(y + 1) * width + (x + 1)];
        // Sobel Y
        const gy = -luminance[(y - 1) * width + (x - 1)] - 2 * luminance[(y - 1) * width + x] - luminance[(y - 1) * width + (x + 1)]
                  + luminance[(y + 1) * width + (x - 1)] + 2 * luminance[(y + 1) * width + x] + luminance[(y + 1) * width + (x + 1)];
        const mag = Math.sqrt(gx * gx + gy * gy);
        edgeStrength[idx] = mag;
        if (mag > maxEdge) maxEdge = mag;
      }
    }
    // Normalize to 0-1
    if (maxEdge > 0) {
      for (let i = 0; i < edgeStrength.length; i++) {
        edgeStrength[i] /= maxEdge;
      }
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;

      if (hasBg && bgMask![idx] === 1) {
        heights[idx] = roundToPrecision(0.5 * baseLayerHeightMm, 2);
        continue;
      }

      if (levels === 0) {
        heights[idx] = roundToPrecision(baseLayerHeightMm, 2);
        continue;
      }

      const lum = luminance[idx] / 255;
      const inverted = 1 - lum;

      // Edge-aware dithering: reduce dither strength at strong edges
      const edgeFactor = 1 - edgeStrength[idx];
      const effectiveDither = dithering * edgeFactor;

      const threshold = BLUE_NOISE_16[y % 16][x % 16];
      const ditherOffset = (threshold - 0.5) * effectiveDither; // center around 0
      const dithered = inverted + ditherOffset / levels;
      const minLevel = (hasBg && reserveLayerForBg) ? 1 : 0;
      const level = clamp(levelFromThresholds(dithered, t), minLevel, levels);

      const heightMm = baseLayerHeightMm + level * layerHeightMm;
      heights[idx] = roundToPrecision(heightMm, 2);
    }
  }

  return heights;
}

/**
 * Floyd-Steinberg error-diffusion dithering.
 * Produces smooth organic gradients without repeating patterns.
 * Quantization error is distributed to neighboring unvisited pixels.
 * For lithopanes: dark = thick (high Z), bright = thin (low Z).
 */
export function floydSteinbergDither(
  luminance: Uint8Array,
  width: number,
  height: number,
  numLayers: number,
  layerHeightMm: number,
  baseLayerHeightMm: number,
  bgMask?: Uint8Array,
  dithering = 1.0,
  thresholds?: number[],
  reserveLayerForBg = true
): Float32Array {
  const heights = new Float32Array(width * height);
  const hasBg = bgMask && bgMask.some((v) => v === 1);
  const levels = numLayers - 1;
  const t = thresholds && thresholds.length === levels ? thresholds : getDefaultThresholds(numLayers);

  if (levels === 0) {
    for (let i = 0; i < heights.length; i++) {
      if (hasBg && bgMask![i] === 1) {
        heights[i] = roundToPrecision(0.5 * baseLayerHeightMm, 2);
      } else {
        heights[i] = roundToPrecision(baseLayerHeightMm, 2);
      }
    }
    return heights;
  }

  // Working buffer in floating point (0–1 inverted luminance)
  const buf = new Float32Array(width * height);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = 1 - luminance[i] / 255; // inverted: dark→1 (thick), bright→0 (thin)
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;

      if (hasBg && bgMask![idx] === 1) {
        heights[idx] = roundToPrecision(0.5 * baseLayerHeightMm, 2);
        continue;
      }

      const old = buf[idx];
      const minLevel = (hasBg && reserveLayerForBg) ? 1 : 0;
      const level = clamp(levelFromThresholds(old, t), minLevel, levels);
      const quantized = level / levels;
      heights[idx] = roundToPrecision(baseLayerHeightMm + level * layerHeightMm, 2);

      // Distribute error to neighbors, scaled by dithering strength
      const err = (old - quantized) * dithering;
      if (x + 1 < width)                    buf[idx + 1]         += err * 7 / 16;
      if (y + 1 < height && x > 0)          buf[idx + width - 1] += err * 3 / 16;
      if (y + 1 < height)                   buf[idx + width]     += err * 5 / 16;
      if (y + 1 < height && x + 1 < width)  buf[idx + width + 1] += err * 1 / 16;
    }
  }

  return heights;
}

/**
 * Generic error-diffusion dithering engine.
 * Takes a diffusion kernel (array of {dx, dy, weight} offsets) and a divisor.
 * All error-diffusion variants (Floyd-Steinberg, Atkinson, JJN, Stucki) use this.
 */
function errorDiffusionDither(
  luminance: Uint8Array,
  width: number,
  height: number,
  numLayers: number,
  layerHeightMm: number,
  baseLayerHeightMm: number,
  kernel: { dx: number; dy: number; w: number }[],
  divisor: number,
  bgMask?: Uint8Array,
  dithering = 1.0,
  thresholds?: number[],
  reserveLayerForBg = true
): Float32Array {
  const heights = new Float32Array(width * height);
  const hasBg = bgMask && bgMask.some((v) => v === 1);
  const levels = numLayers - 1;
  const t = thresholds && thresholds.length === levels ? thresholds : getDefaultThresholds(numLayers);

  if (levels === 0) {
    for (let i = 0; i < heights.length; i++) {
      if (hasBg && bgMask![i] === 1) {
        heights[i] = roundToPrecision(0.5 * baseLayerHeightMm, 2);
      } else {
        heights[i] = roundToPrecision(baseLayerHeightMm, 2);
      }
    }
    return heights;
  }

  const buf = new Float32Array(width * height);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = 1 - luminance[i] / 255;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;

      if (hasBg && bgMask![idx] === 1) {
        heights[idx] = roundToPrecision(0.5 * baseLayerHeightMm, 2);
        continue;
      }

      const old = buf[idx];
      const minLevel = (hasBg && reserveLayerForBg) ? 1 : 0;
      const level = clamp(levelFromThresholds(old, t), minLevel, levels);
      const quantized = level / levels;
      heights[idx] = roundToPrecision(baseLayerHeightMm + level * layerHeightMm, 2);

      const err = (old - quantized) * dithering;
      for (const k of kernel) {
        const nx = x + k.dx;
        const ny = y + k.dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          buf[ny * width + nx] += err * k.w / divisor;
        }
      }
    }
  }

  return heights;
}

/**
 * Atkinson error-diffusion dithering.
 * Only distributes 75% of the quantization error (6/8), producing
 * more open, contrasty results. Popular in early Mac rendering.
 * Better for 3D printing than Floyd-Steinberg: fewer isolated dots.
 */
export function atkinsonDither(
  luminance: Uint8Array,
  width: number,
  height: number,
  numLayers: number,
  layerHeightMm: number,
  baseLayerHeightMm: number,
  bgMask?: Uint8Array,
  dithering = 1.0,
  thresholds?: number[],
  reserveLayerForBg = true
): Float32Array {
  // Atkinson distributes 1/8 to 6 neighbors (total 6/8 = 75%)
  const kernel = [
    { dx: 1, dy: 0, w: 1 },
    { dx: 2, dy: 0, w: 1 },
    { dx: -1, dy: 1, w: 1 },
    { dx: 0, dy: 1, w: 1 },
    { dx: 1, dy: 1, w: 1 },
    { dx: 0, dy: 2, w: 1 },
  ];
  return errorDiffusionDither(luminance, width, height, numLayers, layerHeightMm, baseLayerHeightMm, kernel, 8, bgMask, dithering, thresholds, reserveLayerForBg);
}

/**
 * Jarvis-Judice-Ninke error-diffusion dithering.
 * 5×3 kernel distributes error over 12 neighbors, producing the
 * smoothest perceptual gradients of any error diffusion method.
 * Spreads error wider → fewer visible patterns.
 */
export function jarvisJudiceNinkeDither(
  luminance: Uint8Array,
  width: number,
  height: number,
  numLayers: number,
  layerHeightMm: number,
  baseLayerHeightMm: number,
  bgMask?: Uint8Array,
  dithering = 1.0,
  thresholds?: number[],
  reserveLayerForBg = true
): Float32Array {
  //            *   7   5
  //  3   5   7   5   3
  //  1   3   5   3   1
  // divisor = 48
  const kernel = [
    { dx: 1, dy: 0, w: 7 }, { dx: 2, dy: 0, w: 5 },
    { dx: -2, dy: 1, w: 3 }, { dx: -1, dy: 1, w: 5 }, { dx: 0, dy: 1, w: 7 }, { dx: 1, dy: 1, w: 5 }, { dx: 2, dy: 1, w: 3 },
    { dx: -2, dy: 2, w: 1 }, { dx: -1, dy: 2, w: 3 }, { dx: 0, dy: 2, w: 5 }, { dx: 1, dy: 2, w: 3 }, { dx: 2, dy: 2, w: 1 },
  ];
  return errorDiffusionDither(luminance, width, height, numLayers, layerHeightMm, baseLayerHeightMm, kernel, 48, bgMask, dithering, thresholds, reserveLayerForBg);
}

/**
 * Stucki error-diffusion dithering.
 * 5×3 kernel similar to JJN but with slightly different weights,
 * producing a middle ground between Floyd-Steinberg sharpness and
 * JJN smoothness. Good balance of detail and gradient fidelity.
 */
export function stuckiDither(
  luminance: Uint8Array,
  width: number,
  height: number,
  numLayers: number,
  layerHeightMm: number,
  baseLayerHeightMm: number,
  bgMask?: Uint8Array,
  dithering = 1.0,
  thresholds?: number[],
  reserveLayerForBg = true
): Float32Array {
  //            *   8   4
  //  2   4   8   4   2
  //  1   2   4   2   1
  // divisor = 42
  const kernel = [
    { dx: 1, dy: 0, w: 8 }, { dx: 2, dy: 0, w: 4 },
    { dx: -2, dy: 1, w: 2 }, { dx: -1, dy: 1, w: 4 }, { dx: 0, dy: 1, w: 8 }, { dx: 1, dy: 1, w: 4 }, { dx: 2, dy: 1, w: 2 },
    { dx: -2, dy: 2, w: 1 }, { dx: -1, dy: 2, w: 2 }, { dx: 0, dy: 2, w: 4 }, { dx: 1, dy: 2, w: 2 }, { dx: 2, dy: 2, w: 1 },
  ];
  return errorDiffusionDither(luminance, width, height, numLayers, layerHeightMm, baseLayerHeightMm, kernel, 42, bgMask, dithering, thresholds, reserveLayerForBg);
}

/**
 * Hard quantization — no dithering.
 * Each pixel is rounded to the nearest discrete layer.
 * Produces clean, sharp bands between tonal zones.
 */
export function hardQuantize(
  luminance: Uint8Array,
  width: number,
  height: number,
  numLayers: number,
  layerHeightMm: number,
  baseLayerHeightMm: number,
  bgMask?: Uint8Array,
  thresholds?: number[],
  reserveLayerForBg = true
): Float32Array {
  const heights = new Float32Array(width * height);
  const hasBg = bgMask && bgMask.some((v) => v === 1);
  const levels = numLayers - 1;
  const t = thresholds && thresholds.length === levels ? thresholds : getDefaultThresholds(numLayers);

  for (let i = 0; i < heights.length; i++) {
    if (hasBg && bgMask![i] === 1) {
      heights[i] = roundToPrecision(0.5 * baseLayerHeightMm, 2);
      continue;
    }
    if (levels === 0) {
      heights[i] = roundToPrecision(baseLayerHeightMm, 2);
      continue;
    }
    const inverted = 1 - luminance[i] / 255;
    const minLevel = (hasBg && reserveLayerForBg) ? 1 : 0;
    const level = clamp(levelFromThresholds(inverted, t), minLevel, levels);
    heights[i] = roundToPrecision(baseLayerHeightMm + level * layerHeightMm, 2);
  }

  return heights;
}

/**
 * Apply circular mask: set heights outside inscribed circle to 0.
/**
 * Morphological closing (dilation then erosion) on a quantized heightmap.
 * Connects diagonally adjacent dithered dots into printable ridges
 * that the Arachne wall generator can trace as continuous toolpaths.
 * Uses a 3×3 circular kernel (diamond shape: skip corners).
 */
export function morphologicalClose(
  heights: Float32Array,
  width: number,
  height: number,
  bgMask?: Uint8Array
): Float32Array {
  // 3×3 diamond kernel offsets (excluding corners for circular shape)
  const kernel = [
    [0, 0], [-1, 0], [1, 0], [0, -1], [0, 1],
  ];

  // Dilation: take max in neighborhood (skip BG pixels)
  const dilated = new Float32Array(heights.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (bgMask && bgMask[idx] === 1) { dilated[idx] = heights[idx]; continue; }
      let maxVal = 0;
      for (const [dx, dy] of kernel) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const ni = ny * width + nx;
          if (bgMask && bgMask[ni] === 1) continue; // don't sample BG neighbors
          const v = heights[ni];
          if (v > maxVal) maxVal = v;
        }
      }
      dilated[idx] = maxVal;
    }
  }

  // Erosion: take min in neighborhood (skip BG pixels)
  const closed = new Float32Array(heights.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (bgMask && bgMask[idx] === 1) { closed[idx] = dilated[idx]; continue; }
      let minVal = Infinity;
      for (const [dx, dy] of kernel) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const ni = ny * width + nx;
          if (bgMask && bgMask[ni] === 1) continue; // don't sample BG neighbors
          const v = dilated[ni];
          if (v < minVal) minVal = v;
        }
      }
      closed[idx] = minVal;
    }
  }
  return closed;
}

/**
 * Chamfer Z-step edges in a quantized heightmap.
 * Applies a small Gaussian blur (~0.5px radius) only at pixels that border
 * a different layer height. This creates ~45° slopes between layers so the
 * slicer sees inset perimeters rather than isolated islands.
 * Does NOT re-quantize — the intermediate Z values are the slopes that
 * Arachne needs to generate continuous, variable-width toolpaths.
 */
export function chamferEdges(
  heights: Float32Array,
  width: number,
  height: number,
  layerHeightMm: number,
  baseLayerHeightMm: number,
  bgMask?: Uint8Array
): Float32Array {
  // Detect edge pixels (adjacent to a different height) — skip BG pixels
  const isEdge = new Uint8Array(heights.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (bgMask && bgMask[idx] === 1) continue; // don't chamfer BG pixels
      const h = heights[idx];
      if (h === 0) continue; // skip exterior
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const ni = ny * width + nx;
            if (bgMask && bgMask[ni] === 1) continue; // don't compare against BG
            if (heights[ni] !== h && heights[ni] > 0) {
              isEdge[idx] = 1;
            }
          }
        }
      }
    }
  }

  // Apply 3×3 Gaussian blur only at edge pixels
  const kernel = [
    1, 2, 1,
    2, 4, 2,
    1, 2, 1,
  ];
  const kernelSum = 16;
  const result = new Float32Array(heights);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (!isEdge[idx]) continue;
      let sum = 0;
      let ki = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const v = heights[(y + dy) * width + (x + dx)];
          if (v > 0) {
            sum += v * kernel[ki];
          } else {
            // Don't blend with exterior (Z=0) — use center value instead
            sum += heights[idx] * kernel[ki];
          }
          ki++;
        }
      }
      // Keep the continuous blurred value — do NOT re-quantize.
      // The intermediate Z creates a ~45° slope that Arachne interprets
      // as inset perimeters rather than separate islands.
      result[idx] = Math.max(baseLayerHeightMm, sum / kernelSum);
    }
  }
  return result;
}

/**
 * Apply a circular mask to the heightmap, zeroing pixels outside the inscribed circle.
 * These vertices will be "folded" to the rim during mesh generation.
 * When feather > 0, smoothly blend heights near the circle edge toward
 * baseLayerHeight over a feather zone, preventing hard thickness transitions
 * at the boundary.
 */
export function applyCircularMask(
  heights: Float32Array,
  width: number,
  height: number,
  feather = 0,
  baseLayerHeight = 0
): Float32Array {
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) / 2;
  const featherPx = feather * r; // feather as fraction of radius

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const idx = y * width + x;
      if (dist > r) {
        heights[idx] = 0;
      } else if (featherPx > 0 && dist > r - featherPx) {
        // Smooth blend from full height to base layer height at the edge
        const t = (r - dist) / featherPx; // 1 at inner edge, 0 at rim
        const smoothT = t * t * (3 - 2 * t); // smoothstep
        heights[idx] = baseLayerHeight + (heights[idx] - baseLayerHeight) * smoothT;
      }
    }
  }
  return heights;
}

/**
 * Apply brightness and contrast adjustments to luminance data.
 * brightness: -1 (darker) to +1 (brighter), 0 = no change
 * contrast: -1 (flat) to +1 (high contrast), 0 = no change
 */
export function applyBrightnessContrast(
  data: Uint8Array,
  brightness: number,
  contrast: number
): Uint8Array {
  if (brightness === 0 && contrast === 0) return data;

  const out = new Uint8Array(data.length);
  // contrast factor: map [-1,1] to [0, 3] range
  const factor = contrast >= 0 ? 1 + contrast * 2 : 1 + contrast;

  for (let i = 0; i < data.length; i++) {
    let v = data[i] / 255;
    // Apply brightness (shift)
    v += brightness;
    // Apply contrast (scale around midpoint 0.5)
    v = (v - 0.5) * factor + 0.5;
    out[i] = clamp(Math.round(v * 255), 0, 255);
  }
  return out;
}

/**
 * Apply gamma correction.
 * gamma < 1 brightens midtones (more detail in dark areas).
 * gamma > 1 darkens midtones (more detail in bright areas).
 * For lithopanes: gamma < 1 shifts detail into thick (dark) layers,
 * gamma > 1 shifts detail into thin (bright/transmissive) layers.
 */
export function applyGamma(data: Uint8Array, gamma: number): Uint8Array {
  if (gamma === 1.0) return data;

  const invGamma = 1.0 / gamma;
  // Build lookup table for speed
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    lut[i] = clamp(Math.round(Math.pow(i / 255, invGamma) * 255), 0, 255);
  }

  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = lut[data[i]];
  }
  return out;
}

/**
 * Independent shadows and highlights adjustment.
 * shadows: -1 crushes dark tones to black, +1 lifts shadows toward midgray.
 * highlights: -1 pulls bright tones toward midgray, +1 pushes highlights to white.
 * Uses smooth power curves so transitions are natural.
 */
export function applyShadowsHighlights(
  data: Uint8Array,
  shadows: number,
  highlights: number
): Uint8Array {
  if (shadows === 0 && highlights === 0) return data;

  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    let v = data[i] / 255;

    // Shadows affect the dark end (values near 0)
    if (shadows !== 0) {
      // Weight: 1 at black, 0 at white (smooth quadratic falloff)
      const shadowWeight = (1 - v) * (1 - v);
      // Positive shadows lifts darks, negative crushes them
      v += shadows * shadowWeight * 0.5;
    }

    // Highlights affect the bright end (values near 1)
    if (highlights !== 0) {
      // Weight: 0 at black, 1 at white (smooth quadratic rise)
      const highlightWeight = v * v;
      // Positive highlights pushes brights brighter, negative dims them
      v += highlights * highlightWeight * 0.5;
    }

    out[i] = clamp(Math.round(v * 255), 0, 255);
  }
  return out;
}

/**
 * Auto-levels: stretch histogram so darkest pixel maps to 0 and
 * brightest maps to 255. Uses 0.5% clipping at each end to
 * ignore outlier pixels and avoid noise-driven stretching.
 */
export function applyAutoLevels(data: Uint8Array): Uint8Array {
  // Build histogram
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) hist[data[i]]++;

  const clipCount = Math.floor(data.length * 0.005);
  let lo = 0, hi = 255;
  let cumLo = 0, cumHi = 0;

  // Find low clipping point
  for (lo = 0; lo < 256; lo++) {
    cumLo += hist[lo];
    if (cumLo > clipCount) break;
  }
  // Find high clipping point
  for (hi = 255; hi >= 0; hi--) {
    cumHi += hist[hi];
    if (cumHi > clipCount) break;
  }

  if (hi <= lo) return data; // flat image, nothing to stretch

  const range = hi - lo;
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    lut[i] = clamp(Math.round(((i - lo) / range) * 255), 0, 255);
  }

  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = lut[data[i]];
  }
  return out;
}

/**
 * CLAHE-inspired local contrast enhancement.
 * Divides the image into tiles, computes local mean, and blends the pixel
 * toward or away from that mean. amount 0 = off, 1 = moderate, 2 = strong.
 * Uses a large-radius blur as the "local mean" approximation for speed.
 */
export function applyLocalContrast(
  data: Uint8Array,
  width: number,
  height: number,
  amount: number
): Uint8Array {
  if (amount <= 0) return data;

  // Use a large blur radius (~1/6 of image size) as the local mean
  const radius = Math.max(Math.round(Math.min(width, height) / 6), 2);
  const localMean = gaussianBlurWide(data, width, height, radius);

  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const diff = data[i] - localMean[i];
    // Boost local deviation from the mean
    out[i] = clamp(Math.round(localMean[i] + diff * (1 + amount)), 0, 255);
  }
  return out;
}

/**
 * Separable Gaussian blur with configurable radius.
 * Uses box blur approximation via multiple passes for larger radii.
 */
function gaussianBlurWide(
  data: Uint8Array,
  width: number,
  height: number,
  radius: number
): Uint8Array {
  if (radius < 1) return data;

  // Build 1D Gaussian kernel
  const size = Math.ceil(radius) * 2 + 1;
  const half = (size - 1) / 2;
  const sigma = radius / 2;
  const kernel = new Float32Array(size);
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const x = i - half;
    kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
    sum += kernel[i];
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum;

  const temp = new Float32Array(width * height);
  const out = new Uint8Array(width * height);

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = 0; k < size; k++) {
        const sx = clamp(x + k - Math.floor(half), 0, width - 1);
        acc += data[y * width + sx] * kernel[k];
      }
      temp[y * width + x] = acc;
    }
  }

  // Vertical pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = 0; k < size; k++) {
        const sy = clamp(y + k - Math.floor(half), 0, height - 1);
        acc += temp[sy * width + x] * kernel[k];
      }
      out[y * width + x] = clamp(Math.round(acc), 0, 255);
    }
  }

  return out;
}

/**
 * Unsharp mask edge enhancement.
 * Uses a wider Gaussian blur (radius 3) so the edge signal is significant,
 * then adds edges back scaled by `amount` (0 = off, 1 = moderate, 3 = strong).
 */
export function applyEdgeEnhance(
  data: Uint8Array,
  width: number,
  height: number,
  amount: number
): Uint8Array {
  if (amount <= 0) return data;

  // Use radius 3 for meaningful edge detection at ~125px resolution
  const blurred = gaussianBlurWide(data, width, height, 3);
  const out = new Uint8Array(data.length);

  for (let i = 0; i < data.length; i++) {
    const edge = data[i] - blurred[i];
    out[i] = clamp(Math.round(data[i] + amount * edge), 0, 255);
  }
  return out;
}

/**
 * Horizontally flip a canvas/image source.
 * Lithopanes are typically viewed from behind, so mirroring ensures
 * the image reads correctly when backlit.
 */
function mirrorCanvas(
  source: HTMLCanvasElement | HTMLImageElement
): HTMLCanvasElement {
  const sw = source instanceof HTMLCanvasElement ? source.width : source.naturalWidth || source.width;
  const sh = source instanceof HTMLCanvasElement ? source.height : source.naturalHeight || source.height;
  if (!_mirrorCanvas) _mirrorCanvas = document.createElement('canvas');
  _mirrorCanvas.width = sw;
  _mirrorCanvas.height = sh;
  const ctx = _mirrorCanvas.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0); // reset transform from prior use
  // Horizontal flip (X-axis mirror) — lithopanes are viewed from behind
  ctx.translate(sw, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(source, 0, 0);
  return _mirrorCanvas;
}

/**
 * Adaptive segmentation: locally remap luminance so different image regions
 * get different effective layer distributions. Computes a large-radius local
 * mean, then shifts each pixel toward the global midpoint (128), scaled by
 * the amount parameter. Regions with similar tones get spread across more
 * layers, revealing local detail that uniform thresholds would collapse.
 */
export function applyAdaptiveSegmentation(
  data: Uint8Array,
  width: number,
  height: number,
  amount: number
): Uint8Array {
  if (amount <= 0) return data;

  // Large radius (~1/4 image) for broad regional adaptation
  const radius = Math.max(Math.round(Math.min(width, height) / 4), 3);
  const localMean = gaussianBlurWide(data, width, height, radius);

  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const deviation = data[i] - localMean[i];
    // Center around 128, expanding local contrast
    const remapped = 128 + deviation * 1.5;
    // Blend between original and remapped based on amount
    const v = data[i] * (1 - amount) + remapped * amount;
    out[i] = clamp(Math.round(v), 0, 255);
  }
  return out;
}

/**
 * Full processing pipeline:
 * source → downsample → grayscale → auto-levels → brightness/contrast →
 * gamma → shadows/highlights → local contrast → edge enhance → adaptive → blur → dither → mask
 */
export function processImage(
  source: HTMLCanvasElement | HTMLImageElement,
  diameterMm: number,
  nozzleWidthMm: number,
  numLayers: number,
  layerHeightMm: number,
  baseLayerHeightMm: number,
  brightness = 0,
  contrast = 0,
  edgeEnhance = 0,
  gamma = 1.0,
  shadows = 0,
  highlights = 0,
  localContrast = 0,
  autoLevels = false,
  mirror = false,
  edgeFeather = 0,
  dithering = 0.5,
  ditherMethod: DitherMethod = 'blue-noise',
  layerThresholds: number[] = [],
  adaptiveSegmentation = 0,
  autoThresholds = true,
  reserveLayerForBg = true,
  arachneOptimize = false,
  textMask?: Uint8Array | null
): { heightmap: Float32Array; resolution: number; computedThresholds?: number[] } {
  // Mirror the source canvas if requested (horizontal flip for face-down printing)
  const actualSource = mirror ? mirrorCanvas(source) : source;

  const downsampled = downsampleToCanvas(actualSource, diameterMm, nozzleWidthMm);
  const res = downsampled.width;
  const { lum: grayscale, bgMask: rawBgMask } = toGrayscale(downsampled);

  // Merge textMask into bgMask so dithering functions treat text pixels
  // like background (skip them). This avoids wasted computation and
  // prevents error-diffusion from leaking through text areas.
  let bgMask = rawBgMask;
  if (textMask && textMask.length === res * res) {
    bgMask = new Uint8Array(rawBgMask);
    for (let i = 0; i < bgMask.length; i++) {
      if (textMask[i] === 1) bgMask[i] = 1;
    }
  }

  // 1. Auto-levels first (stretch histogram before other adjustments)
  let processed = autoLevels ? applyAutoLevels(grayscale) : grayscale;
  // 2. Brightness & contrast
  processed = applyBrightnessContrast(processed, brightness, contrast);
  // 3. Gamma correction (tone curve)
  processed = applyGamma(processed, gamma);
  // 4. Shadows & highlights (independent dark/light control)
  processed = applyShadowsHighlights(processed, shadows, highlights);
  // 5. Local contrast (CLAHE-inspired adaptive enhancement)
  processed = applyLocalContrast(processed, res, res, localContrast);
  // 6. Edge enhancement (unsharp mask)
  processed = applyEdgeEnhance(processed, res, res, edgeEnhance);
  // 7. Adaptive segmentation (locally remap luminance for region-aware layer allocation)
  processed = applyAdaptiveSegmentation(processed, res, res, adaptiveSegmentation);
  // 8. Final smoothing — two passes of 3×3 Gaussian (~5×5 effective)
  //    to suppress sensor noise that causes dithering flicker
  const blurred = applyGaussianBlur(applyGaussianBlur(processed, res, res), res, res);
  // 9. Quantize to layers via selected dithering method
  let thresholds: number[] | undefined;
  if (layerThresholds.length === numLayers - 1) {
    // User has manually set thresholds — use those
    thresholds = layerThresholds;
  } else if (autoThresholds) {
    // Auto-compute optimal thresholds from the processed image histogram
    thresholds = computeAutoThresholds(blurred, numLayers, bgMask);
  }
  let heights: Float32Array;
  switch (ditherMethod) {
    case 'floyd-steinberg':
      heights = floydSteinbergDither(blurred, res, res, numLayers, layerHeightMm, baseLayerHeightMm, bgMask, dithering, thresholds, reserveLayerForBg);
      break;
    case 'atkinson':
      heights = atkinsonDither(blurred, res, res, numLayers, layerHeightMm, baseLayerHeightMm, bgMask, dithering, thresholds, reserveLayerForBg);
      break;
    case 'jarvis-judice-ninke':
      heights = jarvisJudiceNinkeDither(blurred, res, res, numLayers, layerHeightMm, baseLayerHeightMm, bgMask, dithering, thresholds, reserveLayerForBg);
      break;
    case 'stucki':
      heights = stuckiDither(blurred, res, res, numLayers, layerHeightMm, baseLayerHeightMm, bgMask, dithering, thresholds, reserveLayerForBg);
      break;
    case 'none':
      heights = hardQuantize(blurred, res, res, numLayers, layerHeightMm, baseLayerHeightMm, bgMask, thresholds, reserveLayerForBg);
      break;
    case 'bayer':
    case 'blue-noise':
    default:
      heights = bayerDither(blurred, res, res, numLayers, layerHeightMm, baseLayerHeightMm, bgMask, dithering, thresholds, reserveLayerForBg);
      break;
  }
  applyCircularMask(heights, res, res, edgeFeather, baseLayerHeightMm);

  // 10. Arachne optimizations:
  //  a) Enforce 2-layer solid base — heightmap data only affects layers above
  //     baseLayer + layerHeight. This prevents single-pixel pillars at 1 layer
  //     and gives a uniform diffuser foundation for backlighting.
  //  b) Morphological closing to connect isolated dithered dots into printable ridges.
  //  c) Chamfer Z-step edges to create continuous slopes (NOT re-quantized)
  //     so the slicer sees inset perimeters rather than separate islands.
  if (arachneOptimize) {
    const solidBase = baseLayerHeightMm + layerHeightMm;
    for (let i = 0; i < heights.length; i++) {
      // Skip BG pixels — they use half-base height for light transmission
      if (bgMask[i] === 1) continue;
      if (heights[i] > 0 && heights[i] < solidBase) {
        heights[i] = solidBase;
      }
    }
    heights = morphologicalClose(heights, res, res, bgMask);
    heights = chamferEdges(heights, res, res, layerHeightMm, baseLayerHeightMm, bgMask);
    // Re-apply circular mask after morphological ops
    applyCircularMask(heights, res, res, edgeFeather, baseLayerHeightMm);
  }

  return { heightmap: heights, resolution: res, computedThresholds: thresholds };
}
