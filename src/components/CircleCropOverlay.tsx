import { type PointerEvent as ReactPointerEvent, useRef, useState, useEffect, useLayoutEffect, useMemo } from 'react';
import type { CropCircle } from '../types';

interface Props {
  crop: CropCircle;
  sourceAspectRatio?: number; // width/height of source content (e.g. 16/9)
  onPointerDown: (e: ReactPointerEvent, action: 'move' | 'resize', contentW: number, contentH: number) => void;
  onPointerMove: (e: ReactPointerEvent, contentW: number, contentH: number) => void;
  onPointerUp: () => void;
  onWheel?: (deltaY: number, contentW: number, contentH: number) => void;
}

/** Compute the visible content area within the container for object-fit: contain */
function computeContainFit(containerW: number, containerH: number, sourceAR: number) {
  const containerAR = containerW / containerH;
  let displayW: number, displayH: number;
  if (sourceAR > containerAR) {
    displayW = containerW;
    displayH = containerW / sourceAR;
  } else {
    displayH = containerH;
    displayW = containerH * sourceAR;
  }
  return {
    displayW,
    displayH,
    offsetX: (containerW - displayW) / 2,
    offsetY: (containerH - displayH) / 2,
  };
}

export default function CircleCropOverlay({ crop, sourceAspectRatio, onPointerDown, onPointerMove, onPointerUp, onWheel }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 100, h: 100 });
  const maskId = useMemo(() => `crop-mask-${Math.random().toString(36).slice(2, 9)}`, []);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // If sourceAspectRatio is known, compute the content-fit area; otherwise fall back to container
  const fit = useMemo(() => {
    if (sourceAspectRatio && sourceAspectRatio > 0) {
      return computeContainFit(size.w, size.h, sourceAspectRatio);
    }
    return { displayW: size.w, displayH: size.h, offsetX: 0, offsetY: 0 };
  }, [size.w, size.h, sourceAspectRatio]);

  // Wheel zoom — native event with { passive: false } to allow preventDefault
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const onWheelRef = useRef(onWheel);
  onWheelRef.current = onWheel;
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (onWheelRef.current) {
        e.preventDefault();
        onWheelRef.current(e.deltaY, fitRef.current.displayW, fitRef.current.displayH);
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  // Crop coords are in source-normalized space (0-1).
  // Map to container pixels via the contain-fit area.
  const minDim = Math.min(fit.displayW, fit.displayH);
  const cxPx = fit.offsetX + crop.cx * fit.displayW;
  const cyPx = fit.offsetY + crop.cy * fit.displayH;
  const rPx = crop.radius * minDim;

  return (
    <div
      ref={containerRef}
      className="circle-overlay"
      onPointerMove={(e) => onPointerMove(e, fit.displayW, fit.displayH)}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      style={{ pointerEvents: 'auto' }}
    >
      <svg
        width={size.w}
        height={size.h}
        viewBox={`0 0 ${size.w} ${size.h}`}
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        <defs>
          <mask id={maskId}>
            <rect width={size.w} height={size.h} fill="white" />
            <circle cx={cxPx} cy={cyPx} r={rPx} fill="black" />
          </mask>
        </defs>

        {/* Darkened area outside circle */}
        <rect
          width={size.w}
          height={size.h}
          fill="rgba(0,0,0,0.6)"
          mask={`url(#${maskId})`}
        />

        {/* Circle border */}
        <circle
          cx={cxPx}
          cy={cyPx}
          r={rPx}
          fill="transparent"
          stroke="rgba(255,255,255,0.8)"
          strokeWidth="2"
          strokeDasharray="6 3"
          className="circle-overlay__handle"
          onPointerDown={(e) => onPointerDown(e, 'move', fit.displayW, fit.displayH)}
        />

        {/* Resize handle — small circle on the edge */}
        <circle
          cx={cxPx + rPx}
          cy={cyPx}
          r="8"
          fill="rgba(233,69,96,0.9)"
          stroke="white"
          strokeWidth="2"
          className="circle-overlay__resize"
          onPointerDown={(e) => onPointerDown(e, 'resize', fit.displayW, fit.displayH)}
        />
      </svg>
    </div>
  );
}
