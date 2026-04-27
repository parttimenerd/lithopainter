/**
 * IEEE 754 safe precision rounding.
 * Prevents floating-point artifacts like 0.3 + 0.6 = 0.8999999999999999
 */
export function roundToPrecision(value: number, decimals: number): number {
  return +(+value).toFixed(decimals);
}

/**
 * 16×16 blue noise threshold matrix (normalized 0–1).
 * Unlike Bayer matrices, blue noise has no directional bias —
 * it distributes thresholds uniformly with maximal spacing,
 * producing organic patterns without visible diagonal lines.
 * Generated via void-and-cluster algorithm.
 */
export const BLUE_NOISE_16: number[][] = (() => {
  // 16×16 blue noise values (0–255), pre-computed
  const raw = [
    [124,  12, 200,  68, 148,  36, 180,  92, 116,   4, 192,  60, 140,  28, 172,  84],
    [ 44, 168,  76, 236,  20, 212, 108,  52, 164,  72, 228,  16, 204, 100,  48, 156],
    [188, 104,   8, 144,  96, 160,   0, 224, 136,  40, 184, 104,  88, 248, 132,   8],
    [ 56, 220, 132,  32, 248, 120,  64, 176,  88, 252, 128,  24, 216, 136,  64, 200],
    [152,  80, 176,  52, 196,  76, 244,  28, 152,  56, 196,  68, 160,  44, 240, 112],
    [ 24, 240, 112,  16, 144, 228,  40, 120, 232, 108,   4, 232, 120,  80, 168,  20],
    [208,  36, 160, 216,  88,  60, 168, 204,  72, 172,  84, 148,  36, 204,  96, 144],
    [128,  72, 248,  48, 180, 124,   8, 100,  48, 244, 128,  52, 252, 132,  48, 224],
    [ 96, 184,   4, 136, 232,  32, 252, 140, 188,  16, 220,   8, 176,  60, 184,  68],
    [ 52, 152, 104,  64, 188, 148,  80, 228,  60, 112, 164,  72, 108, 236, 116,  16],
    [212,  28, 224,  12, 108,  44, 172,  20, 152,  96, 240,  36, 196, 140,  28, 160],
    [120,  76, 176, 156, 240, 200, 120,  68, 208,  40, 188, 124,  52, 172,  88, 248],
    [ 40, 244,  92,  52, 128,   0,  92, 248, 132,  76, 148,  80, 216,  12, 212, 108],
    [192, 136,  20, 220, 168,  60, 236, 156,  28, 228,  20, 252, 100,  64, 136,  44],
    [ 64, 168, 112,  80,  36, 180, 100,  44, 112, 168,  56, 140, 164,  32, 180, 232],
    [  0, 232, 148, 200, 140, 216,   8, 196,  72, 204,  92, 224,  48, 244, 120,  76],
  ];
  return raw.map(row => row.map(v => v / 255));
})();

/**
 * Clamp value between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
