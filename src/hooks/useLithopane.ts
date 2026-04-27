import { useState, useCallback, useRef } from 'react';
import * as THREE from 'three';
import { processImage } from '../processing/imageProcessor';
import { removeBackgroundOptimized } from '../processing/backgroundRemoval';
import { generateLithopaneMesh } from '../three/LithopaneMesh';
import type { LithopaneConfig, ProcessingState } from '../types';
import { roundToPrecision } from '../utils/mathUtils';

export function useLithopane(
  config: LithopaneConfig,
  extractCircle?: (source: HTMLCanvasElement | HTMLImageElement) => HTMLCanvasElement
) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [processing, setProcessing] = useState<ProcessingState>({
    status: 'idle',
    progress: 0,
  });
  const [heightmapData, setHeightmapData] = useState<{ heightmap: Float32Array; resolution: number } | null>(null);
  const processingRef = useRef(0); // generation ID to cancel stale operations
  const busyRef = useRef(false); // prevent overlapping regenerate calls
  // Cache the source canvas after bg removal + circle crop so we can
  // re-process with different image parameters without re-running bg removal.
  const cachedSourceRef = useRef<HTMLCanvasElement | null>(null);
  const [hasCachedSource, setHasCachedSource] = useState(false);

  const effectiveBaseLayer = config.baseLayerHeightMm > 0 ? config.baseLayerHeightMm : config.layerHeightMm;
  const maxThickness = roundToPrecision(
    effectiveBaseLayer + (config.numLayers - 1) * config.layerHeightMm,
    2
  );

  /** Run processImage with all current config params. */
  const runProcessing = useCallback(
    (source: HTMLCanvasElement | HTMLImageElement) => {
      const effectiveBase = config.baseLayerHeightMm > 0 ? config.baseLayerHeightMm : config.layerHeightMm;
      return processImage(
        source,
        config.diameterMm,
        config.nozzleWidthMm,
        config.numLayers,
        config.layerHeightMm,
        effectiveBase,
        config.brightness,
        config.contrast,
        config.edgeEnhance,
        config.gamma,
        config.shadows,
        config.highlights,
        config.localContrast,
        config.autoLevels,
        config.mirror,
        config.edgeFeather
      );
    },
    [config]
  );

  /** Build mesh from heightmap. */
  const buildMesh = useCallback(
    (heightmap: Float32Array, resolution: number) => {
      const effectiveBase = config.baseLayerHeightMm > 0 ? config.baseLayerHeightMm : config.layerHeightMm;
      return generateLithopaneMesh(
        heightmap,
        resolution,
        config.diameterMm,
        config.numLayers,
        config.layerHeightMm,
        config.numNotches,
        config.notchRadiusMm,
        config.notchHeightMm,
        effectiveBase
      );
    },
    [config]
  );

  // Keep refs to latest processing functions so regenerate is stable
  const runProcessingRef = useRef(runProcessing);
  runProcessingRef.current = runProcessing;
  const buildMeshRef = useRef(buildMesh);
  buildMeshRef.current = buildMesh;

  /**
   * Process a source into a lithopane mesh.
   * When withBgRemoval is true, source should be the FULL uncropped image.
   * BG removal runs first, then circle crop is applied.
   * When false, source should already be circle-cropped.
   */
  // Keep ref to extractCircle so generate is stable
  const extractCircleRef = useRef(extractCircle);
  extractCircleRef.current = extractCircle;

  const configRef = useRef(config);
  configRef.current = config;

  const generate = useCallback(
    async (sourceCanvas: HTMLCanvasElement, withBgRemoval = false) => {
      const genId = ++processingRef.current;

      try {
        let processedSource: HTMLCanvasElement | HTMLImageElement = sourceCanvas;

        if (withBgRemoval) {
          setProcessing({ status: 'removing-bg', progress: 0 });
          const bgRemoved = await removeBackgroundOptimized(sourceCanvas, (p) => {
            if (genId === processingRef.current) {
              setProcessing({ status: 'removing-bg', progress: p });
            }
          }, configRef.current.bgModel);
          if (genId !== processingRef.current) return; // cancelled
          // Circle-crop AFTER bg removal so the model sees the full image
          const ec = extractCircleRef.current;
          processedSource = ec ? ec(bgRemoved) : bgRemoved;
        }

        // Cache the source so image params can be adjusted without re-running bg removal
        if (processedSource instanceof HTMLCanvasElement) {
          cachedSourceRef.current = processedSource;
          setHasCachedSource(true);
        }

        if (genId !== processingRef.current) return;
        setProcessing({ status: 'processing', progress: 0.5 });

        const { heightmap, resolution } = runProcessingRef.current(processedSource);
        setHeightmapData({ heightmap, resolution });

        if (genId !== processingRef.current) return;
        setProcessing({ status: 'generating-mesh', progress: 0.8 });

        const geo = buildMeshRef.current(heightmap, resolution);

        if (genId !== processingRef.current) {
          geo.dispose();
          return;
        }

        // Dispose old geometry
        setGeometry((prev) => {
          prev?.dispose();
          return geo;
        });
        setProcessing({ status: 'done', progress: 1 });
      } catch (err) {
        if (genId === processingRef.current) {
          setProcessing({
            status: 'error',
            progress: 0,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
    },
    []
  );

  /**
   * Re-process the cached source with current image parameters.
   * Skips bg removal — useful when only sliders changed.
   * Uses requestAnimationFrame to yield so the UI stays responsive.
   */
  const regenerate = useCallback(() => {
    const cached = cachedSourceRef.current;
    if (!cached) return;

    // If already busy, just bump the generation ID so in-flight work is cancelled
    const genId = ++processingRef.current;
    if (busyRef.current) return;

    busyRef.current = true;
    setProcessing({ status: 'processing', progress: 0.5 });

    // Helper: finish a run and re-trigger if a newer request arrived
    const finish = () => {
      busyRef.current = false;
      if (genId !== processingRef.current) regenerate();
    };

    // Yield a frame so the UI can update before heavy computation
    setTimeout(() => {
      if (genId !== processingRef.current) { finish(); return; }
      try {
        const { heightmap, resolution } = runProcessingRef.current(cached);
        setHeightmapData({ heightmap, resolution });

        if (genId !== processingRef.current) { finish(); return; }
        setProcessing({ status: 'generating-mesh', progress: 0.8 });

        // Yield another frame before mesh generation
        setTimeout(() => {
          if (genId !== processingRef.current) { finish(); return; }
          try {
            const geo = buildMeshRef.current(heightmap, resolution);

            setGeometry((prev) => {
              prev?.dispose();
              return geo;
            });
            setProcessing({ status: 'done', progress: 1 });
          } catch (err) {
            if (genId === processingRef.current) {
              setProcessing({
                status: 'error',
                progress: 0,
                error: err instanceof Error ? err.message : 'Unknown error',
              });
            }
          }
          finish();
        }, 0);
      } catch (err) {
        if (genId === processingRef.current) {
          setProcessing({
            status: 'error',
            progress: 0,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
        finish();
      }
    }, 0);
  }, []);

  /**
   * Fast generation for live preview (no bg removal).
   */
  const generateLive = useCallback(
    (sourceCanvas: HTMLCanvasElement) => {
      try {
        const { heightmap, resolution } = runProcessingRef.current(sourceCanvas);
        setHeightmapData({ heightmap, resolution });
        const geo = buildMeshRef.current(heightmap, resolution);

        setGeometry((prev) => {
          prev?.dispose();
          return geo;
        });
      } catch {
        // Silently skip frame errors in live mode
      }
    },
    []
  );

  return { geometry, processing, maxThickness, generate, generateLive, regenerate, hasCachedSource, heightmapData };
}
