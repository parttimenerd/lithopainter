import { removeToCanvas, newSession, rembgConfig, type RemoveOptions } from '@bunnio/rembg-web';

type Session = Awaited<ReturnType<typeof newSession>>;

const sessionCache = new Map<string, Promise<Session>>();

// u2netp is bundled locally in public/models/; all other models are fetched from HuggingFace CDN.
const HF_BASE_URL = 'https://huggingface.co/bunnio/dis_anime/resolve/main';
const LOCAL_BASE_URL = import.meta.env.BASE_URL + 'models';

// Serialize session creation so base URL mutations don't race
let sessionChain = Promise.resolve<unknown>(undefined);

/** Lazily create and cache a session for the given model name. */
function getSession(modelName: string): Promise<Session> {
  let promise = sessionCache.get(modelName);
  if (!promise) {
    // Chain session creation to avoid base URL race conditions
    promise = sessionChain.then(() => {
      rembgConfig.setBaseUrl(modelName === 'u2netp' ? LOCAL_BASE_URL : HF_BASE_URL);
      return newSession(modelName);
    });
    sessionCache.set(modelName, promise);
    // Remove from cache on failure so retry is possible
    promise.catch(() => sessionCache.delete(modelName));
    sessionChain = promise.then(() => {}, () => {});
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
