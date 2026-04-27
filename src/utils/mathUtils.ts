/**
 * IEEE 754 safe precision rounding.
 * Prevents floating-point artifacts like 0.3 + 0.6 = 0.8999999999999999
 */
export function roundToPrecision(value: number, decimals: number): number {
  return +(+value).toFixed(decimals);
}

/**
 * 4×4 Bayer ordered dithering matrix.
 * Values 0–15, used to create predictable cross-hatch patterns
 * that produce long continuous toolpaths for the 0.4mm nozzle.
 */
export const BAYER_4X4: number[][] = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** Normalized Bayer matrix (values 0–1) */
export const BAYER_4X4_NORM: number[][] = BAYER_4X4.map((row) =>
  row.map((v) => v / 16)
);

/**
 * Clamp value between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
