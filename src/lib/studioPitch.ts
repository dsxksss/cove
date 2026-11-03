import type { StudioAsset, StudioPitch } from "../studio/types";
import { invokeNative } from "./native";

export function normalizePitch(pitch?: StudioPitch): StudioPitch {
  return { semitones: Number.isFinite(pitch?.semitones) ? Math.round(Math.max(-24, Math.min(24, pitch!.semitones)) * 10) / 10 : 0, preserveFormants: pitch?.preserveFormants !== false };
}
export function studioAssetPlaybackKey(asset: Pick<StudioAsset, "id" | "url">, pitch?: StudioPitch): string {
  const value = normalizePitch(pitch);
  return JSON.stringify([asset.id, asset.url, value.semitones, value.semitones !== 0 && value.preserveFormants]);
}

const cache = new Map<string, { promise: Promise<ArrayBuffer>; bytes: number }>();
const CACHE_LIMIT = 192 * 1024 * 1024;
function trimCache() {
  let size = [...cache.values()].reduce((total, entry) => total + entry.bytes, 0);
  for (const [key, entry] of cache) {
    if (size <= CACHE_LIMIT && cache.size <= 8) break;
    if (entry.bytes === 0) continue;
    size -= entry.bytes; cache.delete(key);
  }
}
function toBase64(bytes: ArrayBuffer): string {
  const data = new Uint8Array(bytes), parts: string[] = [];
  for (let i = 0; i < data.length; i += 32768) parts.push(String.fromCharCode(...data.subarray(i, i + 32768)));
  return btoa(parts.join(""));
}

/** Cache derived PCM only; project assets and clip positions always retain the original recording. */
export async function pitchedAudioBytes(context: BaseAudioContext, asset: Pick<StudioAsset, "id" | "name" | "url">, pitch: StudioPitch): Promise<ArrayBuffer> {
  const settings = normalizePitch(pitch), key = studioAssetPlaybackKey(asset, settings);
  const existing = cache.get(key);
  if (existing) { cache.delete(key); cache.set(key, existing); return existing.promise; }
  const entry = { bytes: 0, promise: Promise.resolve(new ArrayBuffer(0)) };
  entry.promise = (async () => {
    const response = await fetch(asset.url);
    if (!response.ok) throw new Error(`读取失败：${response.status}`);
    const original = await response.arrayBuffer();
    const decoded = await context.decodeAudioData(original.slice(0));
    const encoded = await invokeNative<string>("studio_pitch_audio", { inputBase64: toBase64(original), semitones: settings.semitones, preserveFormants: settings.preserveFormants, durationSec: decoded.duration });
    const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0)).buffer;
    entry.bytes = bytes.byteLength; trimCache();
    return bytes;
  })().catch(error => { if (cache.get(key) === entry) cache.delete(key); throw error; });
  cache.set(key, entry);
  return entry.promise;
}
