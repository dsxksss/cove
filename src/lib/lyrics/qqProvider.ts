/**
 * QQ Music lyric search + fetch — ported from Folia qqLyricProvider.ts
 * (simplified to return plain LRC for our player).
 */

import { httpProxy } from "../httpProxy";
import { qrcDecrypt } from "./qrcDecrypt";
import { looksLikeTimedLrc, qrcToLrc } from "./formatConvert";

export type ExternalLyricHit = {
  id: number;
  name: string;
  artist: string;
  album: string;
  durationMs: number;
  qqMid?: string;
  kgHash?: string;
  source: "qq" | "kugou";
};

async function requestQQ(method: string, module: string, param: Record<string, unknown>) {
  const payload = {
    comm: {
      ct: 11,
      cv: "1003006",
      v: "1003006",
      os_ver: "15",
      phonetype: "24122RKC7C",
      tmeAppID: "qqmusiclight",
      nettype: "NETWORK_WIFI",
      udid: "0",
      uid: "0",
    },
    request: { method, module, param },
  };

  const res = await httpProxy({
    url: "https://u.y.qq.com/cgi-bin/musicu.fcg",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: "tmeLoginType=-1;",
    },
    body: JSON.stringify(payload),
  });

  if (res.status < 200 || res.status >= 300 || !res.bodyText) {
    throw new Error(`QQ API HTTP ${res.status}`);
  }
  const data = JSON.parse(res.bodyText);
  if (data.code !== 0 || data.request?.code !== 0) {
    throw new Error(`QQ API error: ${data.code ?? data.request?.code}`);
  }
  return data.request.data;
}

function toBase64(str: string): string {
  try {
    return btoa(unescape(encodeURIComponent(str)));
  } catch {
    return btoa(
      encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) =>
        String.fromCharCode(parseInt(p1, 16))
      )
    );
  }
}

export async function searchQQLyrics(
  keyword: string,
  page = 1,
  pageSize = 10
): Promise<ExternalLyricHit[]> {
  const safe = keyword.trim();
  if (!safe) return [];
  const param = {
    search_id: String(Math.floor(Math.random() * 1e14 + (Date.now() % 86400000))),
    remoteplace: "search.android.keyboard",
    query: safe.length > 60 ? safe.slice(0, 60) : safe,
    search_type: 0,
    num_per_page: pageSize,
    page_num: page,
    highlight: 0,
    nqc_flag: 0,
    page_id: 1,
    grp: 1,
  };

  try {
    const data = await requestQQ(
      "DoSearchForQQMusicLite",
      "music.search.SearchCgiService",
      param
    );
    const songs = data?.body?.item_song || [];
    return songs.map((info: any) => ({
      id: Number(info.id || 0),
      name: info.title || "未知歌曲",
      artist: (info.singer || []).map((s: any) => s.name).filter(Boolean).join(" / ") || "未知歌手",
      album: info.album?.name || "",
      durationMs: (info.interval || 0) * 1000,
      qqMid: info.mid,
      source: "qq" as const,
    }));
  } catch (e) {
    console.error("[QQ] search failed", e);
    return [];
  }
}

export async function fetchQQLyrics(hit: ExternalLyricHit): Promise<{
  lrc: string;
  tlyric: string;
} | null> {
  if (!hit.id || !hit.qqMid) throw new Error("Missing QQ id/mid");

  const param = {
    albumName: toBase64(hit.album || ""),
    crypt: 1,
    ct: 19,
    cv: 2111,
    interval: Math.floor(hit.durationMs / 1000),
    lrc_t: 0,
    qrc: 1,
    qrc_t: 0,
    roma: 1,
    roma_t: 0,
    singerName: toBase64(hit.artist || ""),
    songID: Number(hit.id),
    songName: toBase64(hit.name),
    trans: 1,
    trans_t: 0,
    type: 0,
  };

  try {
    const data = await requestQQ(
      "GetPlayLyricInfo",
      "music.musichallSong.PlayLyricInfo",
      param
    );
    const encryptedLyricHex = data?.lyric;
    const encryptedTransHex = data?.trans;
    if (!encryptedLyricHex) return null;

    const decrypted = await qrcDecrypt(encryptedLyricHex);
    const decryptedTrans = encryptedTransHex
      ? await qrcDecrypt(encryptedTransHex)
      : "";

    const isQrc =
      decrypted.includes("(") &&
      decrypted.includes(")") &&
      /\[\d+,\d+\]/.test(decrypted);
    const lrc = isQrc
      ? qrcToLrc(decrypted)
      : looksLikeTimedLrc(decrypted)
        ? decrypted
        : qrcToLrc(decrypted);
    const tlyric =
      decryptedTrans &&
      (looksLikeTimedLrc(decryptedTrans)
        ? decryptedTrans
        : qrcToLrc(decryptedTrans));

    if (!looksLikeTimedLrc(lrc)) return null;
    return { lrc, tlyric: tlyric || "" };
  } catch (e) {
    console.error("[QQ] fetch lyrics failed", e);
    return null;
  }
}
