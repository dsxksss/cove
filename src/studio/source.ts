import { invokeNative } from "../lib/native";
import type { StudioProject } from "./types";

export async function resolveStudioSourceUrl(project: Pick<StudioProject, "source" | "songId">): Promise<string> {
  if ((project.source ?? "netease") !== "netease") throw new Error("当前平台暂不支持自动下载原曲，请选择本地原曲文件");
  // Resolve by song ID, never by the player's currentSrc, which can still be
  // the previous song while the next stream is loading.
  const result = await invokeNative<{ data?: { url?: string | null } }>("netease_song_url", {
    args: { id: Number(project.songId), level: "exhigh" },
  });
  const url = result.data?.url;
  if (!url) throw new Error("当前歌曲没有可用的音频地址，请确认已登录且歌曲可播放");
  return url;
}

export async function downloadStudioOriginal(project: StudioProject) {
  const sourceUrl = (await resolveStudioSourceUrl(project)).replace(/^http:/i, "https:");
  const fileName = `${project.title.replace(/[\\/:*?"<>|]/g, "_")}.mp3`;
  const audio = await invokeNative<{ name?: string; mimeType?: string; base64?: string }>("studio_download_source", {
    args: { sourceUrl, fileName },
  });
  if (!audio.base64) throw new Error("原曲下载内容为空");
  const bytes = Uint8Array.from(atob(audio.base64), (char) => char.charCodeAt(0));
  return new File([bytes], audio.name || fileName, { type: audio.mimeType || "audio/mpeg" });
}
