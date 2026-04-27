import { useRef, useCallback } from 'react';
import { getDefaultThresholds } from '../processing/imageProcessor';

interface Props {
  numLayers: number;
  thresholds: number[];
  autoThresholds: boolean;
  computedThresholds?: number[];
  onChange: (thresholds: number[]) => void;
  onAutoChange: (auto: boolean, thresholds?: number[]) => void;
}

/**
 * Visual editor for layer threshold cutpoints.
 * Shows a gradient bar with draggable handles at each threshold boundary.
 * Dark (thick) on left → bright (thin) on right.
 * When auto is on, thresholds are computed from image histogram (handles still shown but not draggable).
 * Dragging a handle disables auto. Reset re-enables auto.
 */
export default function ThresholdEditor({ numLayers, thresholds, autoThresholds, computedThresholds, onChange, onAutoChange }: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  const levels = numLayers - 1;
  const isCustom = thresholds.length === levels;
  // Use computed thresholds from the actual image when in auto mode
  const autoT = computedThresholds && computedThresholds.length === levels ? computedThresholds : undefined;
  const t = isCustom ? thresholds : (autoT ?? getDefaultThresholds(numLayers));
  const isAuto = autoThresholds && !isCustom;

  const getPosition = useCallback((clientX: number) => {
    if (!barRef.current) return 0;
    const rect = barRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const handlePointerDown = useCallback((index: number, e: React.PointerEvent) => {
    if (isAuto) return; // auto mode — don't allow manual drag
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent) => {
      const pos = getPosition(ev.clientX);
      const newT = [...t];
      const min = index > 0 ? newT[index - 1] + 0.02 : 0.02;
      const max = index < levels - 2 ? newT[index + 1] - 0.02 : 0.98;
      newT[index] = Math.max(min, Math.min(max, pos));
      onAutoChange(false, newT);
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [t, levels, getPosition, onChange, onAutoChange, isAuto]);

  const reset = useCallback(() => {
    onAutoChange(true, []);
  }, [onAutoChange]);

  if (levels <= 0) return null;

  // Build gradient stops for layer bands
  const bandColors = t.map((_, i) => {
    const lightness = 90 - (i / levels) * 70;
    return `hsl(220, 15%, ${lightness}%)`;
  });
  bandColors.push(`hsl(220, 15%, ${90 - 70}%)`);

  const gradientStops: string[] = [];
  let prev = 0;
  for (let i = 0; i < t.length; i++) {
    gradientStops.push(`${bandColors[i]} ${prev * 100}%`);
    gradientStops.push(`${bandColors[i]} ${t[i] * 100}%`);
    prev = t[i];
  }
  gradientStops.push(`${bandColors[levels]} ${prev * 100}%`);
  gradientStops.push(`${bandColors[levels]} 100%`);

  return (
    <div className="threshold-editor">
      <div className="threshold-editor__header">
        <label className="toggle toggle--sm">
          <input type="checkbox" checked={isAuto} onChange={(e) => {
            if (e.target.checked) {
              onAutoChange(true, []);
            } else {
              onAutoChange(false);
            }
          }} />
          Auto Thresholds
        </label>
        {isCustom && (
          <button className="threshold-editor__reset" onClick={reset}>Reset</button>
        )}
      </div>
      <div
        className={`threshold-editor__bar${isAuto ? ' threshold-editor__bar--auto' : ''}`}
        ref={barRef}
        style={{ background: `linear-gradient(to right, ${gradientStops.join(', ')})` }}
      >
        {t.map((val, i) => (
          <div
            key={i}
            className={`threshold-editor__handle${isAuto ? ' threshold-editor__handle--auto' : ''}`}
            style={{ left: `${val * 100}%` }}
            onPointerDown={(e) => handlePointerDown(i, e)}
            title={`Threshold ${i + 1}: ${val.toFixed(2)}`}
          />
        ))}
      </div>
      <div className="threshold-editor__labels">
        <span>Thin</span>
        <span>Thick</span>
      </div>
    </div>
  );
}
