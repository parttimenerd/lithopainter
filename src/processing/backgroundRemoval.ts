import { removeToCanvas, newSession, type RemoveOptions } from '@bunnio/rembg-web';

type Session = Awaited<ReturnType<typeof newSession>>;

const sessionCache = new Map<string, Promise<Session>>();

/** Lazily create and cache a session for the given model name. */
function getSession(modelName: string): Promise<Session> {
  let promise = sessionCache.get(modelName);
  if (!promise) {
    promise = newSession(modelName);
    sessionCache.set(modelName, promise);
  }
  return promise;
}

/**
 * Remove background from a canvas using @bunnio/rembg-web.
 * Supports multiple models: u2netp, u2net, isnet_general_use, isnet_anime, silueta, u2net_human_seg.
 */
export async function removeBackgroundOptimized(
  sourceCanvas: HTMLCanvasElement,
  onProgress?: (progress: number) => void,
  modelName: string = 'u2netp'
): Promise<HTMLCanvasElement> {
  const session = await getSession(modelName);
  const options: RemoveOptions = {
    session,
    postProcessMask: true,
    onProgress: onProgress
      ? (info) => onProgress(info.progress / 100)
      : undefined,
  };
  return removeToCanvas(sourceCanvas, options);
}
