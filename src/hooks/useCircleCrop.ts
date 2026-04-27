import { useState, useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { type CropCircle, DEFAULT_CROP } from '../types';
import { clamp } from '../utils/mathUtils';

export function useCircleCrop(initial: CropCircle = DEFAULT_CROP) {
  const [crop, setCrop] = useState<CropCircle>(initial);
  const dragging = useRef<'move' | 'resize' | null>(null);
  const dragStart = useRef({ x: 0, y: 0, cx: 0, cy: 0, radius: 0 });

  const onPointerDown = useCallback(
    (e: ReactPointerEvent, action: 'move' | 'resize', _contentW: number, _contentH: number) => {
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragging.current = action;
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        cx: crop.cx,
        cy: crop.cy,
        radius: crop.radius,
      };
    },
    [crop]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent, contentW: number, contentH: number) => {
      if (!dragging.current) return;
      // Divide by the content display area (not the full container)
      // so crop coords stay in source-normalized space
      const dx = (e.clientX - dragStart.current.x) / contentW;
      const dy = (e.clientY - dragStart.current.y) / contentH;

      // Radius is relative to min(contentW, contentH), so compute the
      // fraction of each axis the circle occupies for proper clamping
      const minDim = Math.min(contentW, contentH);

      if (dragging.current === 'move') {
        setCrop((prev) => {
          const rFracX = (prev.radius * minDim) / contentW;
          const rFracY = (prev.radius * minDim) / contentH;
          return {
            ...prev,
            cx: clamp(dragStart.current.cx + dx, rFracX, 1 - rFracX),
            cy: clamp(dragStart.current.cy + dy, rFracY, 1 - rFracY),
          };
        });
      } else {
        // resize: distance from center determines new radius
        const dist = Math.sqrt(dx * dx + dy * dy);
        const sign = dx + dy > 0 ? 1 : -1;
        const newRadius = clamp(dragStart.current.radius + sign * dist, 0.05, 0.5);
        setCrop((prev) => {
          const rFracX = (newRadius * minDim) / contentW;
          const rFracY = (newRadius * minDim) / contentH;
          return {
            cx: clamp(prev.cx, rFracX, 1 - rFracX),
            cy: clamp(prev.cy, rFracY, 1 - rFracY),
            radius: newRadius,
          };
        });
      }
    },
    []
  );

  const onPointerUp = useCallback(() => {
    dragging.current = null;
  }, []);

  const extractCanvasRef = useRef<HTMLCanvasElement | null>(null);

  /**
   * Extract the circle region from a source canvas/video element.
   * Returns a square canvas containing only the cropped circle pixels.
   * Reuses a single canvas to avoid memory pressure in live mode.
   */
  const extractCircle = useCallback(
    (source: HTMLCanvasElement | HTMLVideoElement | HTMLImageElement): HTMLCanvasElement => {
      const sw = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
      const sh = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
      const minDim = Math.min(sw, sh);
      const rPx = crop.radius * minDim;
      const cxPx = crop.cx * sw;
      const cyPx = crop.cy * sh;

      const size = Math.max(Math.round(rPx * 2), 4); // minimum 4px to avoid 0-size canvas
      let out = extractCanvasRef.current;
      if (!out || out.width !== size || out.height !== size) {
        out = document.createElement('canvas');
        out.width = size;
        out.height = size;
        extractCanvasRef.current = out;
      }
      const ctx = out.getContext('2d')!;

      // Clear previous content and clip to circle
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.clip();

      // Draw the source region
      ctx.drawImage(
        source,
        cxPx - rPx,
        cyPx - rPx,
        rPx * 2,
        rPx * 2,
        0,
        0,
        size,
        size
      );
      ctx.restore();

      return out;
    },
    [crop]
  );

  return { crop, setCrop, onPointerDown, onPointerMove, onPointerUp, extractCircle };
}
