/**
 * Media Session helpers — OS media keys, lock-screen / notification controls.
 * Pure builders live here so they can be unit-tested without a browser session.
 */

export type MediaSessionArtwork = {
  src: string;
  sizes?: string;
  type?: string;
};

export type MediaSessionTrackMeta = {
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
};

/** Build MediaMetadata-compatible payload for the currently playing track. */
export function buildMediaMetadata(track: MediaSessionTrackMeta): {
  title: string;
  artist: string;
  album: string;
  artwork: MediaSessionArtwork[];
} {
  const title = track.title?.trim() || "未知歌曲";
  const artist = track.artist?.trim() || "未知歌手";
  const album = track.album?.trim() || "";
  const artwork: MediaSessionArtwork[] = [];
  const url = track.artworkUrl?.trim();
  if (url) {
    // Multiple sizes help OS pick an appropriate asset.
    for (const size of ["96x96", "128x128", "192x192", "256x256", "384x384", "512x512"]) {
      artwork.push({ src: url, sizes: size, type: "image/jpeg" });
    }
  }
  return { title, artist, album, artwork };
}

export type MediaSessionHandlers = {
  play?: () => void;
  pause?: () => void;
  previoustrack?: () => void;
  nexttrack?: () => void;
  seekbackward?: (details: { seekOffset?: number }) => void;
  seekforward?: (details: { seekOffset?: number }) => void;
  seekto?: (details: { seekTime?: number }) => void;
  stop?: () => void;
};

const HANDLER_KEYS: Array<keyof MediaSessionHandlers> = [
  "play",
  "pause",
  "previoustrack",
  "nexttrack",
  "seekbackward",
  "seekforward",
  "seekto",
  "stop",
];

/** Whether Media Session API is available in this environment. */
export function isMediaSessionSupported(
  root: { navigator?: { mediaSession?: unknown } } = globalThis as {
    navigator?: { mediaSession?: unknown };
  }
): boolean {
  return typeof root.navigator?.mediaSession !== "undefined";
}

/**
 * Apply metadata + action handlers to navigator.mediaSession.
 * No-ops when the API is missing (SSR / unsupported webviews).
 */
export function applyMediaSession(
  track: MediaSessionTrackMeta | null,
  handlers: MediaSessionHandlers,
  root: {
    navigator?: {
      mediaSession?: {
        metadata: unknown;
        setActionHandler: (action: string, handler: ((details: any) => void) | null) => void;
        playbackState?: "none" | "paused" | "playing";
      };
    };
    MediaMetadata?: new (init: {
      title?: string;
      artist?: string;
      album?: string;
      artwork?: MediaSessionArtwork[];
    }) => unknown;
  } = globalThis as any
): boolean {
  const session = root.navigator?.mediaSession;
  if (!session) return false;

  if (track) {
    const meta = buildMediaMetadata(track);
    try {
      if (typeof root.MediaMetadata === "function") {
        session.metadata = new root.MediaMetadata(meta);
      } else {
        // Fallback for test doubles without MediaMetadata ctor.
        session.metadata = meta;
      }
    } catch {
      session.metadata = meta;
    }
  } else {
    session.metadata = null;
  }

  for (const key of HANDLER_KEYS) {
    const handler = handlers[key];
    try {
      session.setActionHandler(key, handler ? (details: any) => handler(details ?? {}) : null);
    } catch {
      // Some actions are unsupported on certain platforms — ignore.
    }
  }
  return true;
}

export function setMediaPlaybackState(
  state: "none" | "paused" | "playing",
  root: {
    navigator?: { mediaSession?: { playbackState?: "none" | "paused" | "playing" } };
  } = globalThis as any
): void {
  const session = root.navigator?.mediaSession;
  if (!session) return;
  try {
    session.playbackState = state;
  } catch {
    /* ignore */
  }
}

export function setMediaPositionState(
  position: { duration: number; playbackRate: number; position: number } | null,
  root: {
    navigator?: {
      mediaSession?: {
        setPositionState?: (state?: {
          duration?: number;
          playbackRate?: number;
          position?: number;
        }) => void;
      };
    };
  } = globalThis as any
): void {
  const session = root.navigator?.mediaSession;
  if (!session?.setPositionState) return;
  try {
    if (!position || !Number.isFinite(position.duration) || position.duration <= 0) {
      session.setPositionState();
      return;
    }
    const safePos = Math.max(0, Math.min(position.position, position.duration));
    session.setPositionState({
      duration: position.duration,
      playbackRate: position.playbackRate || 1,
      position: safePos,
    });
  } catch {
    /* ignore invalid state */
  }
}
