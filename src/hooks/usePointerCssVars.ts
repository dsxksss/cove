import { useEffect } from "react";

/**
 * Write pointer position to CSS variables on a target (default documentElement).
 * Throttled with rAF. Disabled when `enabled` is false.
 *
 * Vars: --ptr-x, --ptr-y (px), --ptr-xp, --ptr-yp (0..1)
 */
export function usePointerCssVars(
  enabled: boolean,
  target?: HTMLElement | null
) {
  useEffect(() => {
    if (!enabled) return;
    const el = target ?? document.documentElement;
    let raf = 0;
    let pendingX = 0;
    let pendingY = 0;
    let dirty = false;

    const flush = () => {
      raf = 0;
      if (!dirty) return;
      dirty = false;
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      el.style.setProperty("--ptr-x", `${pendingX}`);
      el.style.setProperty("--ptr-y", `${pendingY}`);
      el.style.setProperty("--ptr-xp", String(pendingX / w));
      el.style.setProperty("--ptr-yp", String(pendingY / h));
    };

    const onMove = (e: PointerEvent) => {
      pendingX = e.clientX;
      pendingY = e.clientY;
      dirty = true;
      if (!raf) raf = requestAnimationFrame(flush);
    };

    const onLeave = () => {
      // Park spotlight off-screen when pointer leaves the window
      pendingX = -9999;
      pendingY = -9999;
      dirty = true;
      if (!raf) raf = requestAnimationFrame(flush);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    document.addEventListener("mouseleave", onLeave);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("mouseleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [enabled, target]);
}
