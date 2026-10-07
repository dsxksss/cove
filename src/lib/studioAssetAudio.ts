import type { StudioAsset } from "../studio/types";

/** Both live playback and offline rendering read the same local audio assets. */
export async function decodeStudioAsset(context: BaseAudioContext, asset: Pick<StudioAsset, "name" | "url">): Promise<AudioBuffer> {
  try {
    if (!asset.url) throw new Error("音频地址为空");
    const response = await fetch(asset.url);
    if (!response.ok) throw new Error(`读取失败：${response.status}`);
    return await context.decodeAudioData(await response.arrayBuffer());
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`无法加载音频「${asset.name}」，请重新导入该音频或重新生成伴奏。${reason}`);
  }
}
