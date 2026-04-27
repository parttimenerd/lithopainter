import { useEffect, useRef, useState, useCallback } from 'react';

export function useWebcam() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setActive(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Camera access denied');
      setActive(false);
    }
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
  }, []);

  /** Capture the current video frame to a reusable offscreen canvas.
   *  Mirrors horizontally to match the CSS scaleX(-1) selfie display,
   *  so crop circle coordinates align with the actual pixel data. */
  const captureFrame = useCallback((): HTMLCanvasElement | null => {
    const video = videoRef.current;
    if (!video || !active) return null;
    let canvas = captureCanvasRef.current;
    if (!canvas || canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      captureCanvasRef.current = canvas;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(-1, 0, 0, 1, video.videoWidth, 0);
    ctx.drawImage(video, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return canvas;
  }, [active]);

  useEffect(() => {
    return () => { stop(); };
  }, [stop]);

  return { videoRef, active, error, start, stop, captureFrame };
}
