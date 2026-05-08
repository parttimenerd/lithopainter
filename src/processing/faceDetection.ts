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
  const faces = await detectFaces(source);
  if (faces.length === 0) return null;
  // Return the largest (most prominent) face
  return faces.reduce((a, b) => b.radius > a.radius ? b : a);
}

/**
 * Detect all faces in a canvas and return crop circle coords for each,
 * sorted by size (largest first).
 */
export async function detectFaces(
  source: HTMLCanvasElement | HTMLVideoElement | HTMLImageElement
): Promise<FaceBounds[]> {
  const det = await getDetector();

  const sw = source instanceof HTMLVideoElement ? source.videoWidth
    : source instanceof HTMLImageElement ? (source.naturalWidth || source.width)
    : source.width;
  const sh = source instanceof HTMLVideoElement ? source.videoHeight
    : source instanceof HTMLImageElement ? (source.naturalHeight || source.height)
    : source.height;

  if (sw === 0 || sh === 0) return [];

  // detectForVideo requires strictly increasing timestamps
  const now = performance.now();
  const ts = now > lastTimestamp ? now : lastTimestamp + 1;
  lastTimestamp = ts;

  const result = det.detectForVideo(source as HTMLCanvasElement, ts);
  
  if (!result.detections.length) return [];

  const minDim = Math.min(sw, sh);
  const faces: FaceBounds[] = [];

  for (const detection of result.detections) {
    const bb = detection.boundingBox;
    if (!bb) continue;

    const faceCx = (bb.originX + bb.width / 2) / sw;
    const faceCy = (bb.originY + bb.height * 0.4) / sh;
    const faceSize = Math.max(bb.width, bb.height);
    const radius = Math.min(Math.max((faceSize / minDim) * 1.3, 0.15), 0.5);

    const rFracX = (radius * minDim) / sw;
    const rFracY = (radius * minDim) / sh;
    const cx = Math.min(Math.max(faceCx, rFracX), 1 - rFracX);
    const cy = Math.min(Math.max(faceCy, rFracY), 1 - rFracY);

    faces.push({ cx, cy, radius });
  }

  // Sort largest first
  faces.sort((a, b) => b.radius - a.radius);
  return faces;
}

/**
 * Compute a crop circle that encompasses multiple faces.
 * Returns a circle whose center is the centroid of the faces and whose
 * radius covers all face circles with padding.
 */
export function encompassFaces(
  faces: FaceBounds[],
  aspectRatio: number
): FaceBounds | null {
  if (faces.length === 0) return null;
  if (faces.length === 1) return faces[0];

  // Centroid of face centers
  let sumCx = 0, sumCy = 0;
  for (const f of faces) { sumCx += f.cx; sumCy += f.cy; }
  const centerX = sumCx / faces.length;
  const centerY = sumCy / faces.length;

  // Find the radius that covers all faces from the centroid
  // Distance is computed in "min-dim-normalized" space
  const ar = aspectRatio || 1;
  let maxExtent = 0;
  for (const f of faces) {
    // Convert to uniform coordinate space using min dimension
    const dx = (f.cx - centerX) * Math.max(ar, 1);
    const dy = (f.cy - centerY) / Math.min(ar, 1);
    const dist = Math.sqrt(dx * dx + dy * dy) + f.radius;
    if (dist > maxExtent) maxExtent = dist;
  }

  const radius = Math.min(maxExtent * 1.15, 0.5); // 15% padding

  // Clamp center
  const rFracX = radius / Math.max(ar, 1);
  const rFracY = radius * Math.min(ar, 1);
  const cx = Math.min(Math.max(centerX, rFracX), 1 - rFracX);
  const cy = Math.min(Math.max(centerY, rFracY), 1 - rFracY);

  return { cx, cy, radius };
}
