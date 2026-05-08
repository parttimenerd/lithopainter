import { useEffect, useRef, useState, useCallback, type PointerEvent as ReactPointerEvent } from 'react';
import { useWebcam } from '../hooks/useWebcam';
import { useCircleCrop } from '../hooks/useCircleCrop';
import { detectFace, detectFaces, encompassFaces, preloadFaceDetector } from '../processing/faceDetection';
import CircleCropOverlay from './CircleCropOverlay';

interface Props {
  onFrame: (canvas: HTMLCanvasElement) => void;
  onCapture: (canvas: HTMLCanvasElement) => void;
  onCaptureWithBg: (canvas: HTMLCanvasElement) => void;
  onCropChange: () => void;
  crop: ReturnType<typeof useCircleCrop>;
  frozen: boolean;
  setFrozen: (v: boolean) => void;
  continuousMode: boolean;
  backgroundRemoval: boolean;
  autoRemoveBgOnFreeze: boolean;
  trackBothFaces: boolean;
}

export default function WebcamView({
  onFrame,
  onCapture,
  onCaptureWithBg,
  onCropChange,
  crop,
  frozen,
  setFrozen,
  continuousMode,
  backgroundRemoval,
  autoRemoveBgOnFreeze,
  trackBothFaces,
}: Props) {
  const { videoRef, active, error, start, stop, captureFrame } = useWebcam();
  const frozenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const frozenImgRef = useRef<HTMLImageElement>(null);
  const [frozenDataUrl, setFrozenDataUrl] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const [videoAR, setVideoAR] = useState(16 / 9);

  // Track video aspect ratio
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const update = () => {
      if (video.videoWidth && video.videoHeight) {
        setVideoAR(video.videoWidth / video.videoHeight);
      }
    };
    video.addEventListener('loadedmetadata', update);
    // Also check on resize in case it was already loaded
    update();
    return () => video.removeEventListener('loadedmetadata', update);
  }, [videoRef, active]);

  // Preload face detection model on mount
  useEffect(() => { preloadFaceDetector(); }, []);

  // Auto-start webcam
  useEffect(() => {
    start();
    return () => stop();
  }, [start, stop]);

  // Stable refs for the live frame loop to avoid re-running the effect on every crop change
  const extractCircleRef = useRef(crop.extractCircle);
  extractCircleRef.current = crop.extractCircle;
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  // Live frame loop for continuous mode
  useEffect(() => {
    if (!active || frozen) return;

    let running = true;
    let lastFrameTime = 0;
    const loop = () => {
      if (!running) return;
      rafRef.current = requestAnimationFrame(loop);
      // Throttle canvas creation to avoid memory pressure
      const now = performance.now();
      if (now - lastFrameTime < 200) return;
      lastFrameTime = now;
      const frame = captureFrame();
      if (frame) {
        const cropped = extractCircleRef.current(frame);
        onFrameRef.current(cropped);
      }
    };

    if (continuousMode) {
      loop();
    }

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [active, frozen, continuousMode, captureFrame]);

  const handleCapture = (withBgRemoval = false) => {
    const frame = captureFrame();
    if (!frame) return;
    // Clone the frame so originalSourceRef in useLithopane doesn't hold
    // a reference to the reused captureCanvas (which gets overwritten).
    const clone = document.createElement('canvas');
    clone.width = frame.width;
    clone.height = frame.height;
    clone.getContext('2d')!.drawImage(frame, 0, 0);
    frozenCanvasRef.current = clone;
    setFrozenDataUrl(clone.toDataURL());
    setFrozen(true);
    if (withBgRemoval) {
      // Pass FULL frame — bg removal needs the whole image, generate circle-crops after
      onCaptureWithBg(clone);
    } else {
      // Pass FULL frame — generate will circle-crop it, keeping the
      // uncropped original cached so recrop works when crop changes.
      onCapture(clone);
    }
  };

  const handleRecapture = () => {
    frozenCanvasRef.current = null;
    setFrozenDataUrl(null);
    setFrozen(false);
  };

  const [detectingFace, setDetectingFace] = useState(false);
  const [faceTrackMode, setFaceTrackMode] = useState<'off' | 'position' | 'resize'>('off');
  const faceTrackModeRef = useRef<'off' | 'position' | 'resize'>('off');
  faceTrackModeRef.current = faceTrackMode;
  const faceTracking = faceTrackMode !== 'off';

  const handleDetectFace = async () => {
    if (detectingFace) return;
    setDetectingFace(true);
    try {
      // Use frozen canvas if frozen, otherwise capture a live frame
      const source = frozen ? frozenCanvasRef.current : captureFrame();
      if (!source) return;
      if (trackBothFaces) {
        const faces = await detectFaces(source);
        const combined = encompassFaces(faces, videoAR);
        if (combined) crop.setCrop({ cx: combined.cx, cy: combined.cy, radius: combined.radius });
      } else {
        const face = await detectFace(source);
        if (face) crop.setCrop({ cx: face.cx, cy: face.cy, radius: face.radius });
      }
    } finally {
      setDetectingFace(false);
    }
  };

  // Stable ref to setCrop so the tracking effect doesn't re-run on every crop change
  const setCropRef = useRef(crop.setCrop);
  setCropRef.current = crop.setCrop;
  const videoARRef = useRef(videoAR);
  videoARRef.current = videoAR;
  const trackBothRef = useRef(trackBothFaces);
  trackBothRef.current = trackBothFaces;

  // Auto face tracking loop — runs alongside the live frame loop
  useEffect(() => {
    if (!active || frozen || !faceTracking) return;
    let running = true;
    let busy = false;
    const trackLoop = async () => {
      if (!running) return;
      if (!busy && faceTrackModeRef.current !== 'off') {
        busy = true;
        try {
          const frame = captureFrame();
          if (frame) {
            const both = trackBothRef.current;
            const faces = await detectFaces(frame);
            let target: { cx: number; cy: number; radius: number } | null = null;

            if (both && faces.length > 1) {
              target = encompassFaces(faces, videoARRef.current || 1);
            } else if (faces.length > 0) {
              // Pick the largest face
              target = faces[0];
            }

            if (target && running) {
              const mode = faceTrackModeRef.current;
              setCropRef.current((prev) => {
                const ar = videoARRef.current || 1;
                const r = mode === 'resize' ? target!.radius : prev.radius;
                const rFracX = r / Math.max(ar, 1);
                const rFracY = r * Math.min(ar, 1);
                const nx = Math.min(Math.max(target!.cx, rFracX), 1 - rFracX);
                const ny = Math.min(Math.max(target!.cy, rFracY), 1 - rFracY);
                if (Math.abs(prev.cx - nx) < 0.002 &&
                    Math.abs(prev.cy - ny) < 0.002 &&
                    Math.abs(prev.radius - r) < 0.002) {
                  return prev;
                }
                return { cx: nx, cy: ny, radius: r };
              });
            }
          }
        } finally {
          busy = false;
        }
      }
      if (running) setTimeout(trackLoop, 100); // ~10 Hz tracking
    };
    trackLoop();
    return () => { running = false; };
  }, [active, frozen, faceTracking, captureFrame]);

  // Disable face tracking when user manually interacts with the crop circle
  const handleCropPointerDown = useCallback(
    (e: ReactPointerEvent, action: 'move' | 'resize', contentW: number, contentH: number) => {
      setFaceTrackMode('off');
      crop.onPointerDown(e, action, contentW, contentH);
    },
    [crop]
  );

  const handleCropWheel = useCallback(
    (deltaY: number, contentW: number, contentH: number) => {
      setFaceTrackMode('off');
      crop.onWheel(deltaY, contentW, contentH);
    },
    [crop]
  );

  // When crop changes while frozen, re-extract from the cached source
  // via the recrop method which preserves BG removal state.
  // Skip the initial trigger when frozen flips to true — handleCapture
  // already processed the frame so recrop would double-crop.
  const onCropChangeRef = useRef(onCropChange);
  onCropChangeRef.current = onCropChange;
  const cropDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const prevFrozenRef = useRef(frozen);
  useEffect(() => {
    const wasFrozen = prevFrozenRef.current;
    prevFrozenRef.current = frozen;
    // Only recrop when the crop itself changed while already frozen
    if (frozen && wasFrozen && frozenCanvasRef.current) {
      clearTimeout(cropDebounceRef.current);
      cropDebounceRef.current = setTimeout(() => onCropChangeRef.current(), 300);
    }
    return () => clearTimeout(cropDebounceRef.current);
  }, [crop.crop, frozen]);

  // Space key → freeze/unfreeze, F key → detect face
  const handleCaptureRef = useRef(handleCapture);
  handleCaptureRef.current = handleCapture;
  const handleRecaptureRef = useRef(handleRecapture);
  handleRecaptureRef.current = handleRecapture;
  const handleDetectFaceRef = useRef(handleDetectFace);
  handleDetectFaceRef.current = handleDetectFace;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const key = e.key.toLowerCase();
      if (key === ' ') {
        e.preventDefault();
        if (frozen) {
          handleRecaptureRef.current();
        } else {
          handleCaptureRef.current(false);
        }
      } else if (key === 'f' && !e.altKey) {
        e.preventDefault();
        handleDetectFaceRef.current();
      } else if (key === 't' && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        setFaceTrackMode((v) => v === 'position' ? 'off' : 'position');
      } else if (key === 't' && !e.altKey && e.shiftKey) {
        e.preventDefault();
        setFaceTrackMode((v) => v === 'resize' ? 'off' : 'resize');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [frozen]);

  return (
    <div className="webcam-view">
      <div className="webcam-container" ref={containerRef}>
        {/* Always-live video feed */}
        <video
          ref={videoRef}
          muted
          playsInline
          style={{ transform: 'scaleX(-1)' }}
        />

        {/* Frozen frame overlay (shown on top when captured, video still plays beneath) */}
        {frozen && frozenDataUrl && (
          <img
            ref={frozenImgRef}
            className="webcam-container__frozen"
            src={frozenDataUrl}
            alt="Captured frame"
          />
        )}

        {/* Circle crop overlay — always interactive */}
        <CircleCropOverlay
          crop={crop.crop}
          sourceAspectRatio={videoAR}
          onPointerDown={handleCropPointerDown}
          onPointerMove={crop.onPointerMove}
          onPointerUp={crop.onPointerUp}
          onWheel={handleCropWheel}
        />

        {error && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: '#e94560', fontSize: 14, padding: 20, textAlign: 'center'
          }}>
            Camera: {error}
          </div>
        )}
      </div>

      {/* Action buttons — outside overflow:hidden container */}
      <div className="webcam-actions">
        {!frozen ? (
          <button className="btn btn--primary" onClick={() => handleCapture(autoRemoveBgOnFreeze)} disabled={!active}>
            ⏸ Freeze
          </button>
        ) : (
          <>
            <button className="btn" onClick={handleRecapture}>
              ↻ Re-capture
            </button>
            <button className="btn btn--accent" onClick={() => {
              if (frozenCanvasRef.current) {
                onCaptureWithBg(frozenCanvasRef.current);
              }
            }}>
              ✂ Remove BG
            </button>
          </>
        )}

        <button className="btn btn--sm" onClick={crop.resetCrop} title="Reset crop circle position and size">
          ⊙ Reset Crop
        </button>
        {frozen && (
          <button className="btn btn--sm" onClick={handleDetectFace} disabled={detectingFace || !frozen} title="Detect face and center crop circle (F)">
            {detectingFace ? '⏳' : '👤'}
          </button>
        )}
        {!frozen && (
          <>
            <button
              className={`btn btn--sm${faceTrackMode === 'position' ? ' btn--active' : ''}`}
              onClick={() => setFaceTrackMode((v) => v === 'position' ? 'off' : 'position')}
              disabled={!active}
              title="Auto-track face position (T)"
            >
              {faceTrackMode === 'position' ? '🔴' : '📍'} Track
            </button>
            <button
              className={`btn btn--sm${faceTrackMode === 'resize' ? ' btn--active' : ''}`}
              onClick={() => setFaceTrackMode((v) => v === 'resize' ? 'off' : 'resize')}
              disabled={!active}
              title="Auto-track face position and resize circle (⇧T)"
            >
              {faceTrackMode === 'resize' ? '🔴' : '📍'} Resize
            </button>
          </>
        )}
      </div>
    </div>
  );
}
