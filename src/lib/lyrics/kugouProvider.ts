/**
 * Kugou lyric search + fetch — ported from Folia kugouLyricProvider.ts
 */

import { httpProxy } from "../httpProxy";
import { md5 } from "../md5";
import { krcDecrypt } from "./krcDecrypt";
import { krcToLrc, looksLikeTimedLrc } from "./formatConvert";
import type { ExternalLyricHit } from "./qqProvider";

const SIGN_SALT = "LnT6xpN3khm36zse0QzvmgTZ3waWdRSA";

function signParams(params: Record<string, string | number>): string {
  const sortedKeys = Object.keys(params).sort();
  let str = SIGN_SALT;
  for (const key of sortedKeys) str += `${key}=${params[key]}`;
  str += SIGN_SALT;
  return md5(str);
}

async function requestKugou(
  url: string,
  params: Record<string, string | number>,
  module: string,
  extraHeaders: Record<string, string> = {}
): Promise<any> {
  const clientTimeMs = Date.now();
  const clientTimeSec = Math.floor(clientTimeMs / 1000);
  const mid = md5(String(clientTimeMs));

  const finalParams: Record<string, string | number> = { ...params };
  if (module !== "Lyric") {
    Object.assign(finalParams, {
      userid: "0",
      appid: "3116",
      token: "",
      clienttime: clientTimeSec,
      iscorrection: "1",
      uuid: "-",
      mid,
      dfid: "-",
      clientver: "11070",
      platform: "AndroidFilter",
    });
  } else {
    Object.assign(finalParams, { appid: "3116", clientver: "11070" });
  }
  finalParams.signature = signParams(finalParams);

  const urlObj = new URL(url);
  for (const [k, v] of Object.entries(finalParams)) {
    urlObj.searchParams.set(k, String(v));
  }

  const res = await httpProxy({
    url: urlObj.toString(),
    method: "GET",
    headers: {
      "User-Agent": `Android14-1070-11070-201-0-${module}-wifi`,
      "KG-Rec": "1",
      "KG-RC": "1",
      "KG-CLIENTTIMEMS": String(clientTimeMs),
      mid,
      ...extraHeaders,
    },
  });

  if (res.status < 200 || res.status >= 300 || !res.bodyText) {
    throw new Error(`Kugou HTTP ${res.status}`);
  }
  const resData = JSON.parse(res.bodyText);
  if (
    resData.error_code !== undefined &&
    resData.error_code !== 0 &&
    resData.error_code !== 200
  ) {
    throw new Error(`Kugou API ${resData.error_code}: ${resData.error_msg}`);
  }
  return resData;
}

export async function searchKugouLyrics(
  keyword: string,
  page = 1,
  pageSize = 10
): Promise<ExternalLyricHit[]> {
  const kw = keyword.trim();
  if (!kw) return [];
  try {
    const data = await requestKugou(
      "http://complexsearch.kugou.com/v2/search/song",
      {
        sorttype: "0",
        keyword: kw,
        pagesize: pageSize,
        page,
      },
      "SearchSong",
      { "x-router": "complexsearch.kugou.com" }
    );
    const lists = data?.data?.lists || [];
    return lists.map((info: any) => ({
      id: Number(info.ID || info.AlbumAudioId || 0),
      name: info.SongName || "未知歌曲",
      artist: (info.Singers || [])
        .map((s: any) => s.name)
        .filter(Boolean)
        .join(" / ") || "未知歌手",
      album: info.AlbumName || "",
      durationMs: (info.Duration || 0) * 1000,
      kgHash: info.FileHash,
      source: "kugou" as const,
    }));
  } catch (e) {
    console.error("[Kugou] search failed", e);
    return searchKugouFallback(kw, page, pageSize);
  }
}

async function searchKugouFallback(
  keyword: string,
  page: number,
  pageSize: number
): Promise<ExternalLyricHit[]> {
  try {
    const url = new URL("http://mobiles.kugou.com/api/v3/search/song");
    Object.entries({
      showtype: "14",
      pagesize: String(pageSize),
      keyword,
      page: String(page),
      version: "9108",
    }).forEach(([k, v]) => url.searchParams.set(k, v));

    const res = await httpProxy({ url: url.toString(), method: "GET" });
    if (!res.bodyText) return [];
    const resData = JSON.parse(res.bodyText);
    const lists = resData?.data?.info || [];
    return lists.map((info: any) => ({
      id: Number(info.album_audio_id || 0),
      name: info.songname || "未知歌曲",
      artist: (info.singername || "")
        .split("、")
        .map((s: string) => s.trim())
        .filter(Boolean)
        .join(" / "),
      album: info.album_name || "",
      durationMs: (info.duration || 0) * 1000,
      kgHash: info.hash,
      source: "kugou" as const,
    }));
  } catch {
    return [];
  }
}

export async function fetchKugouLyrics(hit: ExternalLyricHit): Promise<{
  lrc: string;
  tlyric: string;
} | null> {
  if (!hit.kgHash) throw new Error("Missing Kugou hash");

  try {
    const searchRes = await requestKugou(
      "https://lyrics.kugou.com/v1/search",
      {
        album_audio_id: hit.id,
        duration: hit.durationMs,
        hash: hit.kgHash,
        keyword: `${hit.artist} - ${hit.name}`,
        lrctxt: "1",
        man: "no",
      },
      "Lyric"
    );
    const candidates = searchRes?.candidates || [];
    if (!candidates.length) return null;
    const best = candidates[0];

    const downloadRes = await requestKugou(
      "http://lyrics.kugou.com/download",
      {
        accesskey: best.accesskey,
        charset: "utf8",
        client: "mobi",
        fmt: "krc",
        id: best.id,
        ver: "1",
      },
      "Lyric"
    );

    const base64Str = downloadRes?.content;
    if (!base64Str) return null;

    // Prefer proxy binary path when available; content is base64 in JSON already.
    const binaryString = atob(base64Str);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    let lyricText: string;
    const isKrc =
      bytes.length >= 4 &&
      bytes[0] === 107 &&
      bytes[1] === 114 &&
      bytes[2] === 99 &&
      bytes[3] === 49;

    if (isKrc || String(downloadRes.contenttype) !== "2") {
      try {
        lyricText = await krcDecrypt(bytes);
        lyricText = krcToLrc(lyricText);
      } catch {
        lyricText = new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
        if (!looksLikeTimedLrc(lyricText)) lyricText = krcToLrc(lyricText);
      }
    } else {
      lyricText = new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
    }

    if (!looksLikeTimedLrc(lyricText)) return null;
    return { lrc: lyricText, tlyric: "" };
  } catch (e) {
    console.error("[Kugou] fetch lyrics failed", e);
    return null;
  }
}
