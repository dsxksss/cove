/** Minimal color helpers ported from Folia visualizer/colorMix.ts */

export function colorWithAlpha(color: string, alpha: number): string {
  const a = Math.min(1, Math.max(0, alpha));
  // rgba(...)
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*[\d.]+)?\s*\)$/i.exec(
    color
  );
  if (m) {
    return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${a})`;
  }
  // #rrggbb
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const n = parseInt(hex[1], 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  // fallback white
  return `rgba(255, 255, 255, ${a})`;
}

export function mixColors(
  a: string,
  b: string,
  t: number,
  outAlpha?: number
): string {
  const parse = (c: string): [number, number, number, number] => {
    const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(
      c
    );
    if (m) {
      return [+m[1], +m[2], +m[3], m[4] != null ? +m[4] : 1];
    }
    const hex = /^#([0-9a-f]{6})$/i.exec(c);
    if (hex) {
      const n = parseInt(hex[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
    }
    return [255, 255, 255, 1];
  };
  const tt = Math.min(1, Math.max(0, t));
  const [ar, ag, ab, aa] = parse(a);
  const [br, bg, bb, ba] = parse(b);
  const r = Math.round(ar + (br - ar) * tt);
  const g = Math.round(ag + (bg - ag) * tt);
  const bch = Math.round(ab + (bb - ab) * tt);
  const al = outAlpha != null ? outAlpha : aa + (ba - aa) * tt;
  return `rgba(${r}, ${g}, ${bch}, ${al})`;
}
