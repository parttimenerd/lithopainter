import { useState, useCallback, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { processImage } from '../processing/imageProcessor';
import { removeBackgroundOptimized } from '../processing/backgroundRemoval';
import { createTextMask, applyTextMask } from '../processing/engravingStamp';
import { generateLithopaneMesh, type LithopaneGeometry } from '../three/LithopaneMesh';
import type { LithopaneConfig, ProcessingState } from '../types';
import { roundToPrecision } from '../utils/mathUtils';

export function useLithopane(
  config: LithopaneConfig,
  extractCircle?: (source: HTMLCanvasElement | HTMLImageElement) => HTMLCanvasElement
) {
  const [geometry, setGeometry] = useState<LithopaneGeometry | null>(null);
  const [processing, setProcessing] = useState<ProcessingState>({
    status: 'idle',
    progress: 0,
  });
  const [heightmapData, setHeightmapData] = useState<{ heightmap: Float32Array; resolution: number } | null>(null);
  const [computedThresholds, setComputedThresholds] = useState<number[] | undefined>(undefined);
  const processingRef = useRef(0); // generation ID to cancel stale operations
  const busyRef = useRef(false); // prevent overlapping regenerate calls
  // Cache the source canvas after bg removal + circle crop so we can
  // re-process with different image parameters without re-running bg removal.
  const cachedSourceRef = useRef<HTMLCanvasElement | null>(null);
  // Cache the original (pre-bg-removal) source so we can re-run bg removal with a different model.
  const originalSourceRef = useRef<HTMLCanvasElement | null>(null);
  // Cache the full BG-removed image (before circle crop) so recrop can re-extract without re-running BG removal.
  const bgRemovedFullRef = useRef<HTMLCanvasElement | null>(null);
  const [hasCachedSource, setHasCachedSource] = useState(false);
  const [hasOriginalSource, setHasOriginalSource] = useState(false);

  const effectiveBaseLayer = config.baseLayerHeightMm > 0 ? config.baseLayerHeightMm : config.layerHeightMm;
  const maxThickness = roundToPrecision(
    effectiveBaseLayer + (config.numLayers - 1) * config.layerHeightMm,
    2
  );

  /** Run processImage with all current config params. */
  const runProcessing = useCallback(
    (source: HTMLCanvasElement | HTMLImageElement, textMask?: Uint8Array | null) => {
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
        config.edgeFeather,
        config.dithering,
        config.ditherMethod,
        config.layerThresholds,
        config.adaptiveSegmentation,
        config.autoThresholds,
        config.reserveLayerForBg,
        config.arachneOptimize,
        config.pathMinIsland,
        config.pathBridging,
        config.pathSmoothing,
        textMask
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
        effectiveBase,
        config.arachneOptimize,
        config.nozzleWidthMm
      );
    },
    [config]
  );

  // Keep refs to latest processing functions so regenerate is stable
  const runProcessingRef = useRef(runProcessing);
  runProcessingRef.current = runProcessing;
  const buildMeshRef = useRef(buildMesh);
  buildMeshRef.current = buildMesh;

  /** Run processing with engraving: create text mask first so dithering
   *  skips text pixels, then stamp letter heights after quantisation. */
  const runWithEngraving = useCallback(
    (source: HTMLCanvasElement | HTMLImageElement) => {
      const cfg = configRef.current;
      // Phase 1: build text mask (if engraving enabled) BEFORE dithering
      let textMask: Uint8Array | null = null;
      if (cfg.engravingEnabled && cfg.engravingText) {
        // We need the resolution that processImage will produce.
        // Compute it the same way downsampleToCanvas does: min(ceil(diameter / nozzle), 500).
        const res = Math.min(Math.ceil(cfg.diameterMm / cfg.nozzleWidthMm), 500);
        textMask = createTextMask(res, cfg.diameterMm, cfg.engravingText, cfg.engravingFontSize, cfg.engravingAngle);
      }
      // Phase 2: process image — dithering skips text pixels
      const result = runProcessingRef.current(source, textMask);
      // Phase 3: stamp letter heights on the already-dithered heightmap
      if (textMask) {
        const effectiveBase = cfg.baseLayerHeightMm > 0 ? cfg.baseLayerHeightMm : cfg.layerHeightMm;
        applyTextMask(result.heightmap, textMask, cfg.numLayers, cfg.layerHeightMm, effectiveBase);
      }
      return result;
    },
    []
  );
  const runWithEngravingRef = useRef(runWithEngraving);
  runWithEngravingRef.current = runWithEngraving;

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

      // Always cache a clone of the original (full, pre-processing) source.
      // Must clone because the caller may pass a reused canvas (e.g. extractCircle's canvas).
      const origClone = document.createElement('canvas');
      origClone.width = sourceCanvas.width;
      origClone.height = sourceCanvas.height;
      origClone.getContext('2d')!.drawImage(sourceCanvas, 0, 0);
      originalSourceRef.current = origClone;
      setHasOriginalSource(true);

      // Wait for any in-flight regenerate to notice it's cancelled
      busyRef.current = false;

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
          // Cache the full BG-removed image for later re-cropping
          const bgClone = document.createElement('canvas');
          bgClone.width = bgRemoved.width;
          bgClone.height = bgRemoved.height;
          bgClone.getContext('2d')!.drawImage(bgRemoved, 0, 0);
          bgRemovedFullRef.current = bgClone;
          // Circle-crop AFTER bg removal so the model sees the full image
          const ec = extractCircleRef.current;
          processedSource = ec ? ec(bgRemoved) : bgRemoved;
        } else {
          // Not using BG removal — still apply circle crop from the full source
          bgRemovedFullRef.current = null;
          const ec = extractCircleRef.current;
          if (ec) processedSource = ec(sourceCanvas);
        }

        // Cache a snapshot of the source so image params can be adjusted without
        // re-running bg removal. We must clone because extractCircle reuses a canvas.
        if (processedSource instanceof HTMLCanvasElement) {
          const clone = document.createElement('canvas');
          clone.width = processedSource.width;
          clone.height = processedSource.height;
          clone.getContext('2d')!.drawImage(processedSource, 0, 0);
          cachedSourceRef.current = clone;
          setHasCachedSource(true);
        }

        if (genId !== processingRef.current) return;
        setProcessing({ status: 'processing', progress: 0.5 });

        const { heightmap, resolution, computedThresholds: ct } = runWithEngravingRef.current(processedSource);
        setHeightmapData({ heightmap, resolution });
        setComputedThresholds(ct);

        if (genId !== processingRef.current) return;
        setProcessing({ status: 'generating-mesh', progress: 0.8 });

        const geo = buildMeshRef.current(heightmap, resolution);

        if (genId !== processingRef.current) {
          geo.body.dispose();
          geo.notches?.dispose();
          return;
        }

        // Dispose old geometry
        setGeometry((prev) => {
          prev?.body.dispose();
          prev?.notches?.dispose();
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
   * Yields between processing steps so the UI stays responsive.
   * Only one regeneration runs at a time; newer requests cancel in-flight ones.
   */
  const pendingRef = useRef(false); // a newer regenerate is waiting
  const regenerate = useCallback(() => {
    const cached = cachedSourceRef.current;
    if (!cached) return;

    ++processingRef.current;

    if (busyRef.current) {
      // Signal that a re-run is needed when the current one finishes
      pendingRef.current = true;
      return;
    }

    pendingRef.current = false;
    busyRef.current = true;
    const doWork = () => {
      const genId = processingRef.current;
      setProcessing({ status: 'processing', progress: 0.5 });

      // Yield a frame so the UI can paint before heavy computation
      requestAnimationFrame(() => {
        // Check if a newer request has arrived
        if (genId !== processingRef.current) { finishAndRetry(); return; }
        try {
          const { heightmap, resolution, computedThresholds: ct } = runWithEngravingRef.current(cached);
          setHeightmapData({ heightmap, resolution });
          setComputedThresholds(ct);

          if (genId !== processingRef.current) { finishAndRetry(); return; }
          setProcessing({ status: 'generating-mesh', progress: 0.8 });

          // Yield another frame before mesh generation
          requestAnimationFrame(() => {
            if (genId !== processingRef.current) { finishAndRetry(); return; }
            try {
              const geo = buildMeshRef.current(heightmap, resolution);
              setGeometry((prev) => {
                prev?.body.dispose();
                prev?.notches?.dispose();
                return geo;
              });
              setProcessing({ status: 'done', progress: 1 });
            } catch (err) {
              if (genId === processingRef.current) {
                setProcessing({
                  status: 'error', progress: 0,
                  error: err instanceof Error ? err.message : 'Unknown error',
                });
              }
            }
            finishAndRetry();
          });
        } catch (err) {
          if (genId === processingRef.current) {
            setProcessing({
              status: 'error', progress: 0,
              error: err instanceof Error ? err.message : 'Unknown error',
            });
          }
          finishAndRetry();
        }
      });
    };

    const finishAndRetry = () => {
      busyRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        regenerate();
      }
    };

    doWork();
  }, []);

  /**
   * Fast generation for live preview (no bg removal).
   */
  const generateLive = useCallback(
    (sourceCanvas: HTMLCanvasElement) => {
      try {
        const { heightmap, resolution, computedThresholds: ct } = runWithEngravingRef.current(sourceCanvas);
        setHeightmapData({ heightmap, resolution });
        setComputedThresholds(ct);
        const geo = buildMeshRef.current(heightmap, resolution);

        setGeometry((prev) => {
          prev?.body.dispose();
          prev?.notches?.dispose();
          return geo;
        });
      } catch {
        // Silently skip frame errors in live mode
      }
    },
    []
  );

  /**
   * Re-run the full pipeline (including bg removal) from the cached original source.
   * Used when the bg model changes or bg removal is toggled on.
   */
  const regenerateWithBg = useCallback(() => {
    const original = originalSourceRef.current;
    if (!original) return;
    cachedSourceRef.current = null;
    bgRemovedFullRef.current = null;
    generate(original, true);
  }, [generate]);

  /**
   * Re-run from the original source WITHOUT bg removal.
   * Used when bg removal is toggled off.
   */
  const regenerateWithoutBg = useCallback(() => {
    const original = originalSourceRef.current;
    if (!original) return;
    cachedSourceRef.current = null;
    bgRemovedFullRef.current = null;
    // Circle-crop the original since the non-BG path expects a cropped input.
    // Clone the result because extractCircle reuses a canvas, and generate()
    // stores the source as originalSourceRef.
    const ec = extractCircleRef.current;
    const cropped = ec ? ec(original) : original;
    const clone = document.createElement('canvas');
    clone.width = cropped.width;
    clone.height = cropped.height;
    clone.getContext('2d')!.drawImage(cropped, 0, 0);
    generate(clone, false);
  }, [generate]);

  /**
   * Re-apply circle crop from the cached BG-removed full image (or original)
   * and regenerate. Used when the crop circle moves — avoids re-running BG removal.
   */
  const recrop = useCallback(() => {
    const ec = extractCircleRef.current;
    if (!ec) return;
    // If we have a BG-removed full image, re-crop from it
    const fullSource = bgRemovedFullRef.current || originalSourceRef.current;
    if (!fullSource) return;
    const cropped = ec(fullSource);
    // Clone because extractCircle reuses its canvas
    const clone = document.createElement('canvas');
    clone.width = cropped.width;
    clone.height = cropped.height;
    clone.getContext('2d')!.drawImage(cropped, 0, 0);
    cachedSourceRef.current = clone;
    setHasCachedSource(true);
    regenerate();
  }, [regenerate]);

  /** Clear all caches and reset to initial state. */
  const reset = useCallback(() => {
    ++processingRef.current;
    busyRef.current = false;
    cachedSourceRef.current = null;
    originalSourceRef.current = null;
    bgRemovedFullRef.current = null;
    setHasCachedSource(false);
    setHasOriginalSource(false);
    setHeightmapData(null);
    setGeometry((prev) => {
      prev?.body.dispose();
      prev?.notches?.dispose();
      return null;
    });
    setProcessing({ status: 'idle', progress: 0 });
  }, []);

  // Dispose geometry on unmount to prevent GPU buffer leak
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;
  useEffect(() => () => {
    geometryRef.current?.body.dispose();
    geometryRef.current?.notches?.dispose();
  }, []);

  return { geometry, processing, maxThickness, generate, generateLive, regenerate, regenerateWithBg, regenerateWithoutBg, hasCachedSource, hasOriginalSource, heightmapData, computedThresholds, recrop, reset };
}
