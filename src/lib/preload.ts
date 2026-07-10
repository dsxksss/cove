/**
 * Next-track audio preloader.
 * Warms the browser HTTP cache so the next song starts with less delay.
 */

const cache = new Map<string, HTMLAudioElement>();
const MAX_ENTRIES = 2;

/** Return true if this URL is already warm in the preload cache. */
export function isPreloaded(url: string): boolean {
  return cache.has(url);
}

/** Drop a cached preload entry (and pause its element). */
export function clearPreload(url?: string): void {
  if (url) {
    const el = cache.get(url);
    if (el) {
      try {
        el.pause();
        el.removeAttribute("src");
        el.load();
      } catch {
        /* ignore */
      }
      cache.delete(url);
    }
    return;
  }
  for (const key of [...cache.keys()]) clearPreload(key);
}

/**
 * Start loading `url` into a detached <audio> element.
 * Keeps at most MAX_ENTRIES entries (FIFO eviction of oldest).
 */
export function preloadAudioUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  if (typeof Audio === "undefined") return false;
  if (cache.has(url)) return true;

  // Evict oldest if full
  while (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    clearPreload(oldest);
  }

  try {
    const el = new Audio();
    el.preload = "auto";
    el.src = url;
    // Kick off network fetch without playing.
    el.load();
    cache.set(url, el);
    return true;
  } catch {
    return false;
  }
}

/** Peek currently cached URLs (for tests). */
export function getPreloadedUrls(): string[] {
  return [...cache.keys()];
}
