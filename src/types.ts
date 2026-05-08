export type DitherMethod = 'bayer' | 'blue-noise' | 'floyd-steinberg' | 'atkinson' | 'jarvis-judice-ninke' | 'stucki' | 'none';

export interface LithopaneConfig {
  ditherMethod: DitherMethod;
  diameterMm: number;
  layerHeightMm: number;
  baseLayerHeightMm: number; // initial layer height (0 = same as layerHeightMm)
  numLayers: number;
  nozzleWidthMm: number;
  numNotches: number;
  notchRadiusMm: number;
  notchHeightMm: number;
  backgroundRemoval: boolean;
  autoRemoveBgOnFreeze: boolean; // auto-run BG removal when freezing webcam frame
  trackBothFaces: boolean;         // when tracking, fit crop around both faces instead of just the largest
  bgModel: 'u2netp' | 'u2net' | 'isnet_general_use' | 'isnet_anime' | 'silueta' | 'u2net_human_seg';
  continuousMode: boolean;
  brightness: number; // -1 to 1, default 0
  contrast: number;   // -1 to 1, default 0
  edgeEnhance: number; // 0 to 10, default 0 (0 = off)
  gamma: number;       // 0.2 to 5.0, default 1.0 (1 = linear)
  shadows: number;     // -1 to 1, default 0 (lift/crush dark areas)
  highlights: number;  // -1 to 1, default 0 (boost/reduce bright areas)
  localContrast: number; // 0 to 2, default 0 (CLAHE-inspired)
  autoLevels: boolean;   // stretch histogram to full range
  mirror: boolean;       // horizontally flip image (for printing face-down)
  edgeFeather: number;   // 0 to 1, default 0 (blend edge pixels toward base height)
  dithering: number;     // 0 to 1, default 0.5 (0 = hard quantize, 1 = full dithering)
  layerThresholds: number[]; // N-1 sorted values [0,1] for custom layer cutpoints (empty = even spacing)
  autoThresholds: boolean;    // auto-compute optimal thresholds from image histogram
  adaptiveSegmentation: number; // 0 to 1, default 0 (locally remap luminance for detail-aware layer allocation)
  reserveLayerForBg: boolean;  // when true, foreground never uses the lowest layer (reserved for removed background)
  lightIntensity: number;       // 0.5 to 5.0, default 1.0 — controls brightness of backlight simulation
  absorptionCoefficient: number; // 1 to 20 mm⁻¹, default 8.0 — Lambert-Beer μ for white PLA
  arachneOptimize: boolean;       // optimize mesh for Arachne wall generator (morphological closing, chamfered Z-steps, 0.1mm grid)
  pathMinIsland: number;           // 0 to 20, minimum island size in pixels to keep (0 = off)
  pathBridging: number;            // 0 to 1, gap bridging aggressiveness (0 = off, 1 = cardinal + diagonal)
  pathSmoothing: number;           // 0 to 4, boundary smoothing iterations (0 = off)
  showHeightmap: boolean;          // show 2D heightmap/heatmap preview instead of 3D
  engravingEnabled: boolean;       // enable text engraving around the rim
  engravingText: string;           // text to engrave around the rim
  engravingFontSize: number;       // font size in mm for rim engraving
  engravingAngle: number;          // starting angle in degrees for text placement
  engravingLayers: number;         // number of extra layers for the engraving band (1-3)
}

export const DEFAULT_CONFIG: LithopaneConfig = {
  ditherMethod: 'atkinson',
  diameterMm: 50,
  layerHeightMm: 0.3,
  baseLayerHeightMm: 0,
  numLayers: 4,
  nozzleWidthMm: 0.4,
  numNotches: 10,
  notchRadiusMm: 2,
  notchHeightMm: 3,
  backgroundRemoval: false,
  autoRemoveBgOnFreeze: true,
  trackBothFaces: false,
  bgModel: 'u2net_human_seg',
  continuousMode: true,
  brightness: 0,
  contrast: 0,
  edgeEnhance: 0,
  gamma: 1.0,
  shadows: 0,
  highlights: 0,
  localContrast: 0,
  autoLevels: false,
  mirror: false,
  edgeFeather: 0,
  dithering: 0.5,
  layerThresholds: [],
  autoThresholds: true,
  adaptiveSegmentation: 0,
  reserveLayerForBg: true,
  lightIntensity: 1.0,
  absorptionCoefficient: 8.0,
  arachneOptimize: false,
  pathMinIsland: 6,
  pathBridging: 1.0,
  pathSmoothing: 2,
  showHeightmap: false,
  engravingEnabled: false,
  engravingText: '',
  engravingFontSize: 3,
  engravingAngle: 0,
  engravingLayers: 1,
};

export interface CropCircle {
  /** Center X in normalized coords (0–1 relative to source width) */
  cx: number;
  /** Center Y in normalized coords (0–1 relative to source height) */
  cy: number;
  /** Radius in normalized coords (relative to source min dimension) */
  radius: number;
}

export const DEFAULT_CROP: CropCircle = {
  cx: 0.5,
  cy: 0.5,
  radius: 0.4,
};

export type SourceMode = 'webcam' | 'upload';

export interface ProcessingState {
  status: 'idle' | 'processing' | 'removing-bg' | 'generating-mesh' | 'done' | 'error';
  progress: number; // 0–1
  error?: string;
}

/**
 * A single contour path in mm coordinates (origin at center of disc).
 * Points are densely sampled from Bezier curves — they define the exact
 * boundary at sub-pixel accuracy.
 */
export interface VectorContour {
  points: { x: number; y: number }[];
  /** Signed area in mm² (positive = CCW outer, negative = CW hole) */
  area: number;
}

/**
 * All contours for a single height layer.
 * These define the regions that should be at this height.
 */
export interface VectorLayer {
  /** Physical height in mm for this layer */
  heightMm: number;
  /** Contours defining the filled regions at this height */
  contours: VectorContour[];
}

