import type { AccentColor } from "./types";

/**
 * Extract the dominant color from an image URL via a 1x1 downsample canvas.
 * Falls back gracefully on cross-origin taint / load errors.
 * Uses a larger sample (e.g. 16x16) then averages for a more pleasant result.
 */
export function extractAccent(url: string): Promise<AccentColor | null> {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    img.onload = () => {
      try {
        const size = 16;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        // bucket colors and pick the most saturated dominant bucket
        const buckets = new Map<string, { count: number; r: number; g: number; b: number; weight: number }>();
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          if (a < 128) continue;
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const sat = max === 0 ? 0 : (max - min) / max;
          // skip near-black/near-white
          if (max < 24 || min > 232) continue;
          const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
          const cur = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0, weight: 0 };
          cur.count++;
          const w = 1 + sat * 3;
          cur.r += r * w;
          cur.g += g * w;
          cur.b += b * w;
          cur.weight += w;
          buckets.set(key, cur);
        }
        if (buckets.size === 0) return resolve(null);
        let best: { r: number; g: number; b: number } | null = null;
        let bestW = -1;
        for (const v of buckets.values()) {
          if (v.weight > bestW) {
            bestW = v.weight;
            best = { r: v.r / v.weight, g: v.g / v.weight, b: v.b / v.weight };
          }
        }
        resolve(best as AccentColor | null);
      } catch {
        // SecurityError on tainted canvas
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function rgbToCss(c: AccentColor, alpha = 1): string {
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${alpha})`;
}

/** Brighten a color toward white by t (0..1). */
export function lighten(c: AccentColor, t: number): AccentColor {
  return {
    r: c.r + (255 - c.r) * t,
    g: c.g + (255 - c.g) * t,
    b: c.b + (255 - c.b) * t,
  };
}
