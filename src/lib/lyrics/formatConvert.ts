/**
 * Convert QRC / KRC enhanced timed lyrics into plain LRC lines our parser understands.
 */

function formatLrcTime(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  const sec = Math.floor(s);
  const cs = Math.round((s - sec) * 100);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `[${pad(m)}:${pad(sec)}.${pad(cs)}]`;
}

/** QRC: [startMs,dur]text(wordMs,wordDur)... → [mm:ss.xx]text */
export function qrcToLrc(qrc: string): string {
  const lines: string[] = [];
  for (const raw of qrc.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // Keep standard LRC metadata / timestamps as-is
    if (/^\[\d{1,2}:\d{2}/.test(line)) {
      lines.push(line.replace(/\(\d+,\d+\)/g, ""));
      continue;
    }
    const m = line.match(/^\[(\d+)\s*,\s*(\d+)\](.*)$/);
    if (!m) {
      // XML wrapper noise
      if (line.startsWith("<") || line.startsWith("<?")) continue;
      continue;
    }
    const startMs = parseInt(m[1], 10);
    const text = m[3].replace(/\(\d+\s*,\s*\d+\)/g, "").trim();
    if (!text) continue;
    lines.push(`${formatLrcTime(startMs)}${text}`);
  }
  return lines.join("\n");
}

/** KRC after decrypt often uses [start,dur]<a,b,c>字… → LRC */
export function krcToLrc(krc: string): string {
  const lines: string[] = [];
  for (const raw of krc.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^\[\d{1,2}:\d{2}/.test(line)) {
      lines.push(line.replace(/<\d+,\d+,\d+>/g, ""));
      continue;
    }
    const m = line.match(/^\[(\d+)\s*,\s*(\d+)\](.*)$/);
    if (!m) {
      if (line.startsWith("[")) {
        // [id:…] tags etc.
        continue;
      }
      continue;
    }
    const startMs = parseInt(m[1], 10);
    const text = m[3].replace(/<\d+\s*,\s*\d+\s*,\s*\d+>/g, "").trim();
    if (!text) continue;
    lines.push(`${formatLrcTime(startMs)}${text}`);
  }
  return lines.join("\n");
}

export function looksLikeTimedLrc(text: string): boolean {
  return /\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/.test(text);
}
