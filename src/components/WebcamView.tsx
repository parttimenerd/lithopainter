import { useEffect, useRef, useState, useMemo } from 'react';
import { useWebcam } from '../hooks/useWebcam';
import { useCircleCrop } from '../hooks/useCircleCrop';
import CircleCropOverlay from './CircleCropOverlay';
import type { CropCircle } from '../types';

interface Props {
  onFrame: (canvas: HTMLCanvasElement) => void;
  onCapture: (canvas: HTMLCanvasElement) => void;
  onCaptureWithBg: (canvas: HTMLCanvasElement) => void;
  crop: ReturnType<typeof useCircleCrop>;
  frozen: boolean;
  setFrozen: (v: boolean) => void;
  continuousMode: boolean;
}

export default function WebcamView({
  onFrame,
  onCapture,
  onCaptureWithBg,
  crop,
  frozen,
  setFrozen,
  continuousMode,
}: Props) {
  const { videoRef, active, error, start, stop, captureFrame } = useWebcam();
  const frozenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const frozenImgRef = useRef<HTMLImageElement>(null);
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

  // Auto-start webcam
  useEffect(() => {
    start();
    return () => stop();
  }, [start, stop]);

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
        const cropped = crop.extractCircle(frame);
        onFrame(cropped);
      }
    };

    if (continuousMode) {
      loop();
    }

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [active, frozen, continuousMode, captureFrame, crop, onFrame]);

  const handleCapture = (withBgRemoval = false) => {
    const frame = captureFrame();
    if (!frame) return;
    frozenCanvasRef.current = frame;
    setFrozen(true);
    if (withBgRemoval) {
      // Pass FULL frame — bg removal needs the whole image
      onCaptureWithBg(frame);
    } else {
      const cropped = crop.extractCircle(frame);
      onCapture(cropped);
    }
  };

  const handleRecapture = () => {
    frozenCanvasRef.current = null;
    setFrozen(false);
  };

  // When crop changes while frozen, re-extract from frozen frame
  useEffect(() => {
    if (frozen && frozenCanvasRef.current) {
      const cropped = crop.extractCircle(frozenCanvasRef.current);
      onCapture(cropped);
    }
  }, [crop.crop, frozen]); // eslint-disable-line react-hooks/exhaustive-deps

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
        {frozen && frozenCanvasRef.current && (
          <img
            ref={frozenImgRef}
            className="webcam-container__frozen"
            src={frozenCanvasRef.current.toDataURL()}
            alt="Captured frame"
          />
        )}

        {/* Circle crop overlay — always interactive */}
        <CircleCropOverlay
          crop={crop.crop}
          sourceAspectRatio={videoAR}
          onPointerDown={crop.onPointerDown}
          onPointerMove={crop.onPointerMove}
          onPointerUp={crop.onPointerUp}
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
          <>
            <button className="btn btn--primary" onClick={() => handleCapture(false)} disabled={!active}>
              ⏸ Freeze & Generate
            </button>
            <button className="btn btn--accent" onClick={() => handleCapture(true)} disabled={!active}>
              ✂ Freeze & Remove BG
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={handleRecapture}>
              ↻ Re-capture
            </button>
            <button className="btn btn--primary" onClick={() => {
              if (frozenCanvasRef.current) {
                const cropped = crop.extractCircle(frozenCanvasRef.current);
                onCapture(cropped);
              }
            }}>
              ⟳ Regenerate
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
        {!frozen && (
          <span style={{ fontSize: 11, color: '#888', alignSelf: 'center' }}>
            {continuousMode ? 'Live mode active' : 'Position circle, then freeze'}
          </span>
        )}
      </div>
    </div>
  );
}
