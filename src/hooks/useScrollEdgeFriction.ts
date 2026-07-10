import { useEffect, type RefObject } from "react";

export type ScrollEdge = "start" | "end" | null;

export function detectScrollEdge(
  metrics: { scrollTop: number; scrollHeight: number; clientHeight: number },
  deltaY: number,
): ScrollEdge {
  if (metrics.scrollHeight <= metrics.clientHeight + 1) return null;
  if (deltaY < 0 && metrics.scrollTop <= 1) return "start";
  if (
    deltaY > 0 &&
    metrics.scrollTop + metrics.clientHeight >= metrics.scrollHeight - 1
  ) {
    return "end";
  }
  return null;
}

export function edgeResistanceImpulse(deltaY: number, max = 11): number {
  return Math.max(-max, Math.min(max, -deltaY * 0.085));
}

/**
 * Adds a small physical pull + spring return when a wheel gesture continues
 * past either end of a native scroll container. It never changes scrollTop,
 * so list virtualization and lyric focus calculations stay deterministic.
 */
export function useScrollEdgeFriction(
  ref: RefObject<HTMLElement | null>,
  enabled = true,
) {
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let offset = 0;
    let velocity = 0;
    let frame: number | null = null;

    const render = () => {
      element.style.setProperty("translate", `0 ${offset.toFixed(2)}px`);
    };

    const spring = () => {
      velocity += -offset * 0.2;
      velocity *= 0.68;
      offset += velocity;
      if (Math.abs(offset) < 0.04 && Math.abs(velocity) < 0.04) {
        offset = 0;
        velocity = 0;
        render();
        element.style.removeProperty("will-change");
        frame = null;
        return;
      }
      render();
      frame = window.requestAnimationFrame(spring);
    };

    const onWheel = (event: WheelEvent) => {
      const edge = detectScrollEdge(element, event.deltaY);
      if (!edge) return;
      if (event.cancelable) event.preventDefault();
      offset = Math.max(-12, Math.min(12, offset + edgeResistanceImpulse(event.deltaY)));
      velocity *= 0.35;
      element.style.setProperty("will-change", "translate");
      render();
      if (frame == null) frame = window.requestAnimationFrame(spring);
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheel);
      if (frame != null) window.cancelAnimationFrame(frame);
      element.style.removeProperty("translate");
      element.style.removeProperty("will-change");
    };
  }, [enabled, ref]);
}
