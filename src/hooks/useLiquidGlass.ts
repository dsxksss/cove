import { useEffect, useRef } from "react";
import { getDisplacementFilter } from "../lib/liquidGlass";

export interface LiquidGlassOpts {
  depth?: number;
  strength?: number;
  chromaticAberration?: number;
  blur?: number;
  saturate?: number;
  brightness?: number;
  /** fallback blur as a fraction of width when backdrop-filter:url unsupported */
  fallbackBlurRatio?: number;
}

// Feature-detect backdrop-filter: url() support once.
const supportsBackdropFilterUrl = (() => {
  if (typeof document === "undefined") return false;
  const el = document.createElement("div");
  el.style.cssText = "backdrop-filter: url(#test)";
  return (
    el.style.backdropFilter === "url(#test)" ||
    el.style.backdropFilter === 'url("#test")'
  );
})();

/**
 * Apply the liquid-glass displacement filter to an element via
 * backdrop-filter. Regenerates the size-aware map on resize.
 *
 * Usage: const ref = useLiquidGlass({ depth: 10, strength: 100 });
 *        <div ref={ref} style={{ borderRadius: 28 }} />
 *
 * The element must have an explicit border-radius (CSS or inline) — the radius
 * is read from computed style and feeds the displacement map so it doesn't
 * spike past the rounded corners.
 */
export function useLiquidGlass<T extends HTMLElement>(opts: LiquidGlassOpts = {}) {
  const ref = useRef<T>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const apply = () => {
      const {
        depth = 10,
        strength = 100,
        chromaticAberration = 0,
        blur = 0,
        saturate = 1.5,
        brightness = 1.1,
        fallbackBlurRatio = 0.1,
      } = optsRef.current;
      const rect = el.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (width === 0 || height === 0) return;
      const radius = parseFloat(getComputedStyle(el).borderRadius || "0") || 0;

      if (supportsBackdropFilterUrl) {
        const filter = getDisplacementFilter({
          height,
          width,
          radius,
          depth,
          strength,
          chromaticAberration,
        });
        const bf = `blur(${blur / 2}px) url('${filter}') blur(${blur}px) brightness(${brightness}) saturate(${saturate})`;
        el.style.backdropFilter = bf;
        (el.style as any).webkitBackdropFilter = bf;
      } else {
        // fallback: plain frosted glass (no refraction)
        const fb = Math.max(8, width * fallbackBlurRatio);
        const bf = `blur(${fb}px) saturate(180%)`;
        el.style.backdropFilter = bf;
        (el.style as any).webkitBackdropFilter = bf;
      }
    };

    apply();
    const ro = new ResizeObserver(() => apply());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return ref;
}
