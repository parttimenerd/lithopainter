import { useRef, useEffect } from 'react';

interface Props {
  heightmap: Float32Array;
  resolution: number;
  heatmap?: boolean;
}

const HEATMAP_COLORS: [number, number, number][] = [
  [0, 0, 0],       // 0.0 — black (thinnest)
  [30, 0, 100],     // dark purple
  [80, 0, 180],     // purple
  [180, 0, 200],    // magenta
  [230, 60, 60],    // red
  [255, 160, 0],    // orange
  [255, 230, 50],   // yellow
  [255, 255, 255],  // 1.0 — white (thickest)
];

function heatmapColor(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  const idx = clamped * (HEATMAP_COLORS.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, HEATMAP_COLORS.length - 1);
  const f = idx - lo;
  return [
    HEATMAP_COLORS[lo][0] + (HEATMAP_COLORS[hi][0] - HEATMAP_COLORS[lo][0]) * f,
    HEATMAP_COLORS[lo][1] + (HEATMAP_COLORS[hi][1] - HEATMAP_COLORS[lo][1]) * f,
    HEATMAP_COLORS[lo][2] + (HEATMAP_COLORS[hi][2] - HEATMAP_COLORS[lo][2]) * f,
  ];
}

export default function HeightmapPreview({ heightmap, resolution, heatmap = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = resolution;
    canvas.height = resolution;
    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.createImageData(resolution, resolution);
    const data = imageData.data;

    // Find min/max for normalization
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < heightmap.length; i++) {
      if (heightmap[i] > 0) {
        if (heightmap[i] < min) min = heightmap[i];
        if (heightmap[i] > max) max = heightmap[i];
      }
    }
    if (!isFinite(min)) min = 0;
    if (!isFinite(max)) max = 1;
    const range = max - min || 1;

    for (let i = 0; i < heightmap.length; i++) {
      const px = i * 4;
      if (heightmap[i] <= 0) {
        data[px] = data[px + 1] = data[px + 2] = 0;
        data[px + 3] = 0; // transparent for BG
        continue;
      }
      const t = (heightmap[i] - min) / range;
      if (heatmap) {
        const [r, g, b] = heatmapColor(t);
        data[px] = r;
        data[px + 1] = g;
        data[px + 2] = b;
      } else {
        const v = Math.round(t * 255);
        data[px] = data[px + 1] = data[px + 2] = v;
      }
      data[px + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
  }, [heightmap, resolution, heatmap]);

  return (
    <div className="heightmap-preview">
      <canvas ref={canvasRef} className="heightmap-preview__canvas" />
      <div className="heightmap-preview__legend">
        <span>Thin</span>
        <div className={`heightmap-preview__gradient ${heatmap ? 'heightmap-preview__gradient--heatmap' : ''}`} />
        <span>Thick</span>
      </div>
    </div>
  );
}
