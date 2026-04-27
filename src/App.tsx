import { useState, useCallback, useRef, useEffect, type PointerEvent as ReactPointerEvent } from 'react';
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
      const merged = { ...DEFAULT_CONFIG, ...parsed };
      // Validate numeric fields — reset to default if corrupt
      for (const key of Object.keys(DEFAULT_CONFIG) as (keyof LithopaneConfig)[]) {
        const def = DEFAULT_CONFIG[key];
        if (typeof def === 'number' && !Number.isFinite(merged[key] as number)) {
          (merged as Record<string, unknown>)[key] = def;
        }
        // Validate string enums — if the stored value isn't a valid option, reset
        if (typeof def === 'string' && key === 'bgModel') {
          const valid = ['u2netp', 'u2net', 'isnet_general_use', 'isnet_anime', 'silueta', 'u2net_human_seg'];
          if (!valid.includes(merged[key] as string)) {
            (merged as Record<string, unknown>)[key] = def;
          }
        }
        if (typeof def === 'string' && key === 'ditherMethod') {
          const valid = ['bayer', 'blue-noise', 'floyd-steinberg', 'atkinson', 'jarvis-judice-ninke', 'stucki', 'none'];
          if (!valid.includes(merged[key] as string)) {
            (merged as Record<string, unknown>)[key] = def;
          }
        }
      }
      // Validate layerThresholds — must be an array of numbers
      if (!Array.isArray(merged.layerThresholds) || !merged.layerThresholds.every((v: unknown) => typeof v === 'number')) {
        merged.layerThresholds = [];
      }
      return merged;
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
  const { geometry, processing, maxThickness, generate, generateLive, regenerate, regenerateWithBg, regenerateWithoutBg, hasCachedSource, hasOriginalSource, heightmapData, computedThresholds, recrop, reset } = useLithopane(config, crop.extractCircle);

  // Export needs the geometry reference
  const lithoGeo = geometry;

  // Auto-regenerate from cached source when image processing params change (debounced)
  const prevConfigRef = useRef(config);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const prev = prevConfigRef.current;
    prevConfigRef.current = config;
    // Check if any image processing parameter changed
    const imageParamsChanged = hasCachedSource && (
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
      prev.edgeFeather !== config.edgeFeather ||
      prev.dithering !== config.dithering ||
      prev.ditherMethod !== config.ditherMethod ||
      prev.layerThresholds !== config.layerThresholds ||
      prev.adaptiveSegmentation !== config.adaptiveSegmentation ||
      prev.autoThresholds !== config.autoThresholds ||
      prev.reserveLayerForBg !== config.reserveLayerForBg ||
      prev.arachneOptimize !== config.arachneOptimize);
    // BG removal toggled on, or model changed while BG removal is enabled
    const needsBgRerun = hasOriginalSource && (
      (prev.bgModel !== config.bgModel && config.backgroundRemoval) ||
      (!prev.backgroundRemoval && config.backgroundRemoval));
    // BG removal toggled off — regenerate without BG removal
    const bgTurnedOff = hasOriginalSource &&
      prev.backgroundRemoval && !config.backgroundRemoval;
    if (needsBgRerun) {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => regenerateWithBg(), 350);
    } else if (bgTurnedOff) {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => regenerateWithoutBg(), 350);
    } else if (imageParamsChanged) {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => regenerate(), 350);
    }
    return () => clearTimeout(debounceRef.current);
  }, [config, hasCachedSource, hasOriginalSource, regenerate, regenerateWithBg, regenerateWithoutBg]);

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
      // Don't trigger shortcuts when typing in inputs (except range — allow Alt focus)
      const tag = (e.target as HTMLElement)?.tagName;
      const isRange = (e.target as HTMLInputElement)?.type === 'range';
      if ((tag === 'INPUT' && !isRange) || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const key = e.key.toLowerCase();
      const mod = e.metaKey || e.ctrlKey;
      const alt = e.altKey;

      // Alt+key → focus slider
      if (alt && !mod) {
        const sliderMap: Record<string, string> = {
          b: 'slider-brightness',
          c: 'slider-contrast',
          g: 'slider-gamma',
          s: 'slider-shadows',
          h: 'slider-highlights',
          e: 'slider-edge',
          l: 'slider-local',
          f: 'slider-feather',
          d: 'slider-dithering',
          n: 'slider-layers',
        };
        const sliderId = sliderMap[key];
        if (sliderId) {
          e.preventDefault();
          const el = document.getElementById(sliderId);
          if (el) el.focus();
          return;
        }
      }

      // Don't handle non-Alt shortcuts when a range is focused (let arrows work)
      if (isRange) return;

      if (mod && key === 'e') {
        // Cmd/Ctrl+E → Export STL
        e.preventDefault();
        if (lithoGeo) exportSTL(lithoGeo);
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
      } else if (key === 'escape') {
        // Esc → blur focused slider
        (document.activeElement as HTMLElement)?.blur();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [config, lithoGeo, handleSetConfig]);

  // Resizable left column
  const [leftWidth, setLeftWidth] = useState(50); // percentage
  const draggingRef = useRef(false);
  const appRef = useRef<HTMLDivElement>(null);

  const onDividerPointerDown = useCallback((e: ReactPointerEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onDividerPointerMove = useCallback((e: ReactPointerEvent) => {
    if (!draggingRef.current || !appRef.current) return;
    const rect = appRef.current.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setLeftWidth(Math.max(25, Math.min(75, pct)));
  }, []);

  const onDividerPointerUp = useCallback(() => {
    draggingRef.current = false;
  }, []);

  return (
    <div className="app" ref={appRef} style={{ gridTemplateColumns: `${leftWidth}% 6px 1fr` }}>
      <SourcePanel
        mode={mode}
        setMode={setMode}
        config={config}
        setConfig={handleSetConfig}
        crop={crop}
        onFrame={handleFrame}
        onCapture={handleCapture}
        onCaptureWithBg={handleCaptureWithBg}
        onCropChange={recrop}
        onClear={reset}
        frozen={frozen}
        setFrozen={setFrozen}
        computedThresholds={computedThresholds}
      />
      <div
        className="resize-handle"
        onPointerDown={onDividerPointerDown}
        onPointerMove={onDividerPointerMove}
        onPointerUp={onDividerPointerUp}
      />
      <PreviewPanel
        lithoGeo={lithoGeo}
        maxThickness={maxThickness}
        baseLayerHeightMm={config.baseLayerHeightMm > 0 ? config.baseLayerHeightMm : config.layerHeightMm}
        layerHeightMm={config.layerHeightMm}
        lightIntensity={config.lightIntensity}
        absorptionCoefficient={config.absorptionCoefficient}
        processingState={processing}
      />
    </div>
  );
}
