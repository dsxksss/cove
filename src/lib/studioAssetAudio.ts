import type { StudioAsset, StudioPitch, StudioProject } from "../studio/types";
import { normalizePitch, pitchedAudioBytes } from "./studioPitch";

/** Harmony tracks share persisted asset IDs; refresh every alias on project load. */
export function restoreStudioAssetUrl(project: StudioProject, assetId: string, url: string): void {
  for (const track of project.tracks) for (const asset of track.assets) if (asset.id === assetId) asset.url = url;
  if (project.instrumental?.id === assetId) project.instrumental.url = url;
}

/** Both live playback and offline rendering read the same local audio assets. */
export async function decodeStudioAsset(context: BaseAudioContext, asset: Pick<StudioAsset, "id" | "name" | "url">, pitch?: StudioPitch): Promise<AudioBuffer> {
  try {
    if (!asset.url) throw new Error("音频地址为空");
    if (normalizePitch(pitch).semitones !== 0) return await context.decodeAudioData((await pitchedAudioBytes(context, asset, normalizePitch(pitch))).slice(0));
    const response = await fetch(asset.url);
    if (!response.ok) throw new Error(`读取失败：${response.status}`);
    return await context.decodeAudioData(await response.arrayBuffer());
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`无法加载音频「${asset.name}」，请重新导入该音频或重新生成伴奏。${reason}`);
  }
}
