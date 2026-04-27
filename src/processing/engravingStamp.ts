/**
 * Render the text mask at the given resolution.
 * Returns a Uint8Array where 1 = text pixel, 0 = not text.
 * This is computed before dithering so the dithering functions can skip
 * text pixels entirely (no wasted work, no error-diffusion leakage).
 */
export function createTextMask(
  resolution: number,
  diameterMm: number,
  text: string,
  fontSizeMm: number,
  angleDeg: number
): Uint8Array | null {
  if (!text) return null;

  const mask = new Uint8Array(resolution * resolution);
  const pxPerMm = resolution / diameterMm;
  const outerR = resolution / 2;
  const fontPx = fontSizeMm * pxPerMm;
  const textR = outerR - fontPx * 0.15 - fontPx * 0.5;

  // Render text at higher resolution for crisp edges, then downsample
  const scale = Math.max(2, Math.ceil(512 / resolution));
  const hiRes = resolution * scale;
  const canvas = document.createElement('canvas');
  canvas.width = hiRes;
  canvas.height = hiRes;
  const ctx = canvas.getContext('2d')!;

  const hiFontPx = fontPx * scale;
  const hiCx = hiRes / 2;
  const hiCy = hiRes / 2;
  const hiTextR = textR * scale;

  ctx.font = `bold ${hiFontPx}px sans-serif`;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const startAngle = (angleDeg - 90) * (Math.PI / 180);
  const arcPerPx = 1 / hiTextR;
  const spacing = hiFontPx * 0.08;
  let totalWidth = 0;
  for (const char of text) {
    totalWidth += ctx.measureText(char).width + spacing;
  }
  totalWidth -= spacing;
  const totalArc = totalWidth * arcPerPx;
  let currentAngle = startAngle - totalArc / 2;

  for (const char of text) {
    const charW = ctx.measureText(char).width;
    const charArc = (charW + spacing) * arcPerPx;
    const charAngle = currentAngle + (charW * arcPerPx) / 2;

    ctx.save();
    ctx.translate(
      hiCx + Math.cos(charAngle) * hiTextR,
      hiCy + Math.sin(charAngle) * hiTextR
    );
    ctx.rotate(charAngle + Math.PI / 2);
    ctx.fillText(char, 0, 0);
    ctx.restore();

    currentAngle += charArc;
  }

  // Downsample to target resolution
  const downCanvas = document.createElement('canvas');
  downCanvas.width = resolution;
  downCanvas.height = resolution;
  const downCtx = downCanvas.getContext('2d')!;
  downCtx.drawImage(canvas, 0, 0, resolution, resolution);
  const imageData = downCtx.getImageData(0, 0, resolution, resolution);
  const pixels = imageData.data;

  for (let i = 0; i < resolution * resolution; i++) {
    if (pixels[i * 4 + 3] > 127) mask[i] = 1;
  }

  return mask;
}

/**
 * Apply the text mask to a heightmap: set text pixels to one layer above
 * the max image layer. Call this AFTER dithering/quantisation.
 */
export function applyTextMask(
  heightmap: Float32Array,
  textMask: Uint8Array | null,
  numImageLayers: number,
  layerHeightMm: number,
  baseLayerHeightMm: number
): void {
  if (!textMask) return;

  const maxImageHeight = baseLayerHeightMm + (numImageLayers - 1) * layerHeightMm;
  const letterHeight = maxImageHeight + layerHeightMm;

  for (let i = 0; i < heightmap.length; i++) {
    if (heightmap[i] <= 0) continue; // skip BG
    if (textMask[i] === 1) {
      heightmap[i] = letterHeight;
    }
  }
}

