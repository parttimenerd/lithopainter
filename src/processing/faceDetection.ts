import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';

let detector: FaceDetector | null = null;
let loading: Promise<FaceDetector> | null = null;
let lastTimestamp = 0;

/** Lazily load and cache the MediaPipe BlazeFace-based face detector. */
async function getDetector(): Promise<FaceDetector> {
  if (detector) return detector;
  if (loading) return loading;
  loading = (async () => {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
    );
    const det = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      minDetectionConfidence: 0.5,
    });
    detector = det;
    return det;
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

/** Eagerly start loading the face detector model + WASM runtime. */
export function preloadFaceDetector(): void {
  getDetector();
}

export interface FaceBounds {
  /** Center X in normalized coords (0–1 relative to image width) */
  cx: number;
  /** Center Y in normalized coords (0–1 relative to image height) */
  cy: number;
  /** Radius in normalized coords (relative to image min dimension) */
  radius: number;
}

/**
 * Detect the most prominent face in a canvas and return crop circle coords.
 * The circle is sized to encompass the face bounding box with padding.
 * Returns null if no face is found.
 */
export async function detectFace(
  source: HTMLCanvasElement | HTMLVideoElement | HTMLImageElement
): Promise<FaceBounds | null> {
  const det = await getDetector();

  const sw = source instanceof HTMLVideoElement ? source.videoWidth
    : source instanceof HTMLImageElement ? (source.naturalWidth || source.width)
    : source.width;
  const sh = source instanceof HTMLVideoElement ? source.videoHeight
    : source instanceof HTMLImageElement ? (source.naturalHeight || source.height)
    : source.height;

  if (sw === 0 || sh === 0) return null;

  // detectForVideo requires strictly increasing timestamps
  const now = performance.now();
  const ts = now > lastTimestamp ? now : lastTimestamp + 1;
  lastTimestamp = ts;

  // MediaPipe needs an HTMLImageElement, HTMLVideoElement, or HTMLCanvasElement
  const result = det.detectForVideo(source as HTMLCanvasElement, ts);
  
  if (!result.detections.length) return null;

  // Pick the highest-confidence face
  const best = result.detections.reduce((a, b) =>
    (b.categories[0]?.score ?? 0) > (a.categories[0]?.score ?? 0) ? b : a
  );

  const bb = best.boundingBox;
  if (!bb) return null;

  // Bounding box is in pixel coords — BlazeFace covers forehead-to-chin,
  // so shift center upward to include the crown/hair.
  const faceCx = (bb.originX + bb.width / 2) / sw;
  const faceCy = (bb.originY + bb.height * 0.4) / sh; // 0.4 instead of 0.5 → shift up
  const minDim = Math.min(sw, sh);

  // Size the circle to encompass face + hair + neck with generous padding
  const faceSize = Math.max(bb.width, bb.height);
  const radius = Math.min(Math.max((faceSize / minDim) * 1.3, 0.15), 0.5);

  // Clamp center so the circle (at this radius) stays inside the frame.
  // radius is relative to minDim; cx/cy are relative to width/height.
  const rFracX = (radius * minDim) / sw;
  const rFracY = (radius * minDim) / sh;
  const cx = Math.min(Math.max(faceCx, rFracX), 1 - rFracX);
  const cy = Math.min(Math.max(faceCy, rFracY), 1 - rFracY);

  return { cx, cy, radius };
}
