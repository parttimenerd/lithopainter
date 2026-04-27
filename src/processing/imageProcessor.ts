import { BAYER_4X4_NORM, roundToPrecision, clamp } from '../utils/mathUtils';

/**
 * Downsample a source to the physical print resolution.
 * Resolution = diameterMm / nozzleWidthMm (e.g. 50/0.4 = 125 pixels).
 */
export function downsampleToCanvas(
  source: HTMLCanvasElement | HTMLImageElement,
  diameterMm: number,
  nozzleWidthMm: number
): HTMLCanvasElement {
  const res = Math.ceil(diameterMm / nozzleWidthMm);
  const canvas = document.createElement('canvas');
  canvas.width = res;
  canvas.height = res;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source, 0, 0, res, res);
  return canvas;
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
 * Separable Gaussian blur (3×3 kernel).
 * Ensures minimum feature size exceeds nozzle width.
 */
export function applyGaussianBlur(
  data: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const kernel = [0.25, 0.5, 0.25]; // 1D Gaussian kernel
  const temp = new Float32Array(width * height);
  const out = new Uint8Array(width * height);

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -1; k <= 1; k++) {
        const sx = clamp(x + k, 0, width - 1);
        sum += data[y * width + sx] * kernel[k + 1];
      }
      temp[y * width + x] = sum;
    }
  }

  // Vertical pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -1; k <= 1; k++) {
        const sy = clamp(y + k, 0, height - 1);
        sum += temp[sy * width + x] * kernel[k + 1];
      }
      out[y * width + x] = clamp(Math.round(sum), 0, 255);
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
  bgMask?: Uint8Array
): Float32Array {
  const heights = new Float32Array(width * height);
  const hasBg = bgMask && bgMask.some((v) => v === 1);

  // With bg mask: foreground uses ALL numLayers (layers 1..numLayers).
  // Background gets half a layer height — thinner than layer 1 but not zero
  // (zero = outside circle / folded to rim).
  const levels = Math.max(numLayers - 1, 1); // number of intervals

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;

      // Background pixel → half base layer height (distinct from layer 1)
      if (hasBg && bgMask![idx] === 1) {
        heights[idx] = roundToPrecision(0.5 * baseLayerHeightMm, 2);
        continue;
      }

      const lum = luminance[idx] / 255; // 0 = black (thick), 1 = white (thin)

      // Invert: dark areas → high Z (thick)
      const inverted = 1 - lum;

      // Standard ordered dithering: Bayer threshold offsets fractional position
      const threshold = BAYER_4X4_NORM[y % 4][x % 4];
      const level = clamp(Math.floor(inverted * levels + threshold), 0, levels);

      // Map level to physical height: base layer + additional layers
      const heightMm = baseLayerHeightMm + level * layerHeightMm;

      // IEEE 754 safe rounding
      heights[idx] = roundToPrecision(heightMm, 2);
    }
  }

  return heights;
}

/**
 * Apply circular mask: set heights outside inscribed circle to 0.
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
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d')!;
  // Horizontal flip (X-axis mirror) — lithopanes are viewed from behind
  ctx.translate(sw, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(source, 0, 0);
  return canvas;
}

/**
 * Full processing pipeline:
 * source → downsample → grayscale → auto-levels → brightness/contrast →
 * gamma → shadows/highlights → local contrast → edge enhance → blur → dither → mask
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
  edgeFeather = 0
): { heightmap: Float32Array; resolution: number } {
  // Mirror the source canvas if requested (horizontal flip for face-down printing)
  const actualSource = mirror ? mirrorCanvas(source) : source;

  const downsampled = downsampleToCanvas(actualSource, diameterMm, nozzleWidthMm);
  const res = downsampled.width;
  const { lum: grayscale, bgMask } = toGrayscale(downsampled);

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
  // 7. Final smoothing to ensure features exceed nozzle width
  const blurred = applyGaussianBlur(processed, res, res);
  // 8. Quantize to layers via ordered dithering
  const heights = bayerDither(blurred, res, res, numLayers, layerHeightMm, baseLayerHeightMm, bgMask);
  applyCircularMask(heights, res, res, edgeFeather, baseLayerHeightMm);

  return { heightmap: heights, resolution: res };
}
