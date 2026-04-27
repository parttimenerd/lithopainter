import { useState, useCallback, useRef, useEffect } from 'react';
import SourcePanel from './components/SourcePanel';
import PreviewPanel from './components/PreviewPanel';
import { useCircleCrop } from './hooks/useCircleCrop';
import { useLithopane } from './hooks/useLithopane';
import { exportSTL } from './three/stlExport';
import { DEFAULT_CONFIG, type LithopaneConfig, type SourceMode } from './types';

const STORAGE_KEY = 'lithopane-config';

function loadConfig(): LithopaneConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Merge with defaults to handle new/removed keys
      return { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch { /* ignore corrupt data */ }
  return DEFAULT_CONFIG;
}

function saveConfig(config: LithopaneConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch { /* ignore quota errors */ }
}

export default function App() {
  const [mode, setMode] = useState<SourceMode>('webcam');
  const [config, setConfig] = useState<LithopaneConfig>(loadConfig);
  const [frozen, setFrozen] = useState(false);

  const handleSetConfig = useCallback((c: LithopaneConfig) => {
    setConfig(c);
    saveConfig(c);
  }, []);
  const crop = useCircleCrop();
  const { geometry, processing, maxThickness, generate, generateLive, regenerate, hasCachedSource, heightmapData } = useLithopane(config, crop.extractCircle);

  // Auto-regenerate from cached source when image processing params change (debounced)
  const prevConfigRef = useRef(config);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const prev = prevConfigRef.current;
    prevConfigRef.current = config;
    if (!hasCachedSource) return;
    // Check if any image processing parameter changed
    const imageParamsChanged =
      prev.brightness !== config.brightness ||
      prev.contrast !== config.contrast ||
      prev.edgeEnhance !== config.edgeEnhance ||
      prev.gamma !== config.gamma ||
      prev.shadows !== config.shadows ||
      prev.highlights !== config.highlights ||
      prev.localContrast !== config.localContrast ||
      prev.autoLevels !== config.autoLevels ||
      prev.numLayers !== config.numLayers ||
      prev.layerHeightMm !== config.layerHeightMm ||
      prev.baseLayerHeightMm !== config.baseLayerHeightMm ||
      prev.diameterMm !== config.diameterMm ||
      prev.nozzleWidthMm !== config.nozzleWidthMm ||
      prev.numNotches !== config.numNotches ||
      prev.notchRadiusMm !== config.notchRadiusMm ||
      prev.notchHeightMm !== config.notchHeightMm ||
      prev.mirror !== config.mirror ||
      prev.edgeFeather !== config.edgeFeather;
    if (imageParamsChanged) {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => regenerate(), 350);
    }
    return () => clearTimeout(debounceRef.current);
  }, [config, hasCachedSource, regenerate]);

  // Throttle live frames to avoid overwhelming mesh generation
  const handleFrame = useCallback(
    (canvas: HTMLCanvasElement) => {
      generateLive(canvas);
    },
    [generateLive]
  );

  const handleCapture = useCallback(
    (canvas: HTMLCanvasElement) => {
      generate(canvas, false);
    },
    [generate]
  );

  const handleCaptureWithBg = useCallback(
    (canvas: HTMLCanvasElement) => {
      generate(canvas, true);
    },
    [generate]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const key = e.key.toLowerCase();
      const mod = e.metaKey || e.ctrlKey;

      if (mod && key === 'e') {
        // Cmd/Ctrl+E → Export STL
        e.preventDefault();
        if (geometry) exportSTL(geometry);
      } else if (key === 'r' && !mod) {
        // R → Reset image adjustments to defaults
        e.preventDefault();
        handleSetConfig({
          ...config,
          brightness: DEFAULT_CONFIG.brightness,
          contrast: DEFAULT_CONFIG.contrast,
          gamma: DEFAULT_CONFIG.gamma,
          shadows: DEFAULT_CONFIG.shadows,
          highlights: DEFAULT_CONFIG.highlights,
          edgeEnhance: DEFAULT_CONFIG.edgeEnhance,
          localContrast: DEFAULT_CONFIG.localContrast,
          autoLevels: DEFAULT_CONFIG.autoLevels,
          edgeFeather: DEFAULT_CONFIG.edgeFeather,
        });
      } else if (key === 'm' && !mod) {
        // M → Toggle mirror
        e.preventDefault();
        handleSetConfig({ ...config, mirror: !config.mirror });
      } else if (key === 'b' && !mod) {
        // B → Toggle background removal
        e.preventDefault();
        handleSetConfig({ ...config, backgroundRemoval: !config.backgroundRemoval });
      } else if (key === '1') {
        // 1 → Webcam mode
        e.preventDefault();
        setMode('webcam');
      } else if (key === '2') {
        // 2 → Upload mode
        e.preventDefault();
        setMode('upload');
      } else if (key === ' ' && !mod) {
        // Space → Freeze/unfreeze (webcam)
        e.preventDefault();
        setFrozen(!frozen);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [config, frozen, geometry, handleSetConfig, setFrozen]);

  return (
    <div className="app">
      <SourcePanel
        mode={mode}
        setMode={setMode}
        config={config}
        setConfig={handleSetConfig}
        crop={crop}
        onFrame={handleFrame}
        onCapture={handleCapture}
        onCaptureWithBg={handleCaptureWithBg}
        frozen={frozen}
        setFrozen={setFrozen}
      />
      <PreviewPanel
        geometry={geometry}
        maxThickness={maxThickness}
        layerHeightMm={config.baseLayerHeightMm > 0 ? config.baseLayerHeightMm : config.layerHeightMm}
        processingState={processing}
      />
    </div>
  );
}
