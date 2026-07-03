/**
 * Singleton HTMLAudioElement engine. No howler dependency — native <audio>
 * is well-supported in the Tauri webview and simpler to reason about.
 *
 * The store calls these mutators; event wiring lives in useAudioEngine.
 */
let audio: HTMLAudioElement | null = null;

export function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
    audio.volume = loadVolume();
  }
  return audio;
}

const VOL_KEY = "nmp.volume";
export function loadVolume(): number {
  try {
    const v = parseFloat(localStorage.getItem(VOL_KEY) ?? "0.8");
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.8;
  } catch {
    return 0.8;
  }
}
export function saveVolume(v: number) {
  try {
    localStorage.setItem(VOL_KEY, String(v));
  } catch {
    /* ignore */
  }
}
