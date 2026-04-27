export interface LithopaneConfig {
  diameterMm: number;
  layerHeightMm: number;
  baseLayerHeightMm: number; // initial layer height (0 = same as layerHeightMm)
  numLayers: number;
  nozzleWidthMm: number;
  numNotches: number;
  notchRadiusMm: number;
  notchHeightMm: number;
  backgroundRemoval: boolean;
  bgModel: 'u2netp' | 'u2net' | 'isnet_general_use' | 'isnet_anime' | 'silueta' | 'u2net_human_seg';
  continuousMode: boolean;
  brightness: number; // -1 to 1, default 0
  contrast: number;   // -1 to 1, default 0
  edgeEnhance: number; // 0 to 3, default 0 (0 = off)
  gamma: number;       // 0.2 to 5.0, default 1.0 (1 = linear)
  shadows: number;     // -1 to 1, default 0 (lift/crush dark areas)
  highlights: number;  // -1 to 1, default 0 (boost/reduce bright areas)
  localContrast: number; // 0 to 2, default 0 (CLAHE-inspired)
  autoLevels: boolean;   // stretch histogram to full range
  mirror: boolean;       // horizontally flip image (for printing face-down)
  edgeFeather: number;   // 0 to 1, default 0 (blend edge pixels toward base height)
}

export const DEFAULT_CONFIG: LithopaneConfig = {
  diameterMm: 50,
  layerHeightMm: 0.3,
  baseLayerHeightMm: 0,
  numLayers: 4,
  nozzleWidthMm: 0.4,
  numNotches: 3,
  notchRadiusMm: 2,
  notchHeightMm: 3,
  backgroundRemoval: false,
  bgModel: 'u2netp',
  continuousMode: false,
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
