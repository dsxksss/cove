import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** Keep the song time underneath the pointer fixed while zooming the editor. */
export function useStudioTimelineViewport(projectId: string, disabled: boolean) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(1);
  const anchorRef = useRef<{ ratio: number; x: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const changeZoom = useCallback((value: number, clientX?: number) => {
    const viewport = viewportRef.current, timeline = timelineRef.current;
    if (!viewport || !timeline || disabled) return;
    const next = Math.max(1, Math.min(64, value));
    if (next === zoomRef.current) return;
    const viewportBox = viewport.getBoundingClientRect(), timelineBox = timeline.getBoundingClientRect();
    const x = clientX ?? viewportBox.left + viewport.clientWidth / 2;
    anchorRef.current = { ratio: Math.max(0, Math.min(1, (x - timelineBox.left) / timelineBox.width)), x: x - viewportBox.left };
    zoomRef.current = next;
    setZoom(next);
  }, [disabled]);
  useLayoutEffect(() => {
    const viewport = viewportRef.current, timeline = timelineRef.current, anchor = anchorRef.current;
    if (viewport && timeline && anchor) viewport.scrollLeft = 16 + anchor.ratio * timeline.clientWidth - anchor.x;
    anchorRef.current = null;
  }, [zoom]);
  useEffect(() => {
    zoomRef.current = 1; setZoom(1); anchorRef.current = null;
    if (viewportRef.current) viewportRef.current.scrollLeft = 0;
  }, [projectId]);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault(); // Prevent browser zoom, including at the limits.
      if (event.buttons) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
      changeZoom(zoomRef.current * Math.exp(-Math.max(-240, Math.min(240, delta)) * 0.004), event.clientX);
    };
    viewport.addEventListener("wheel", wheel, { passive: false });
    return () => viewport.removeEventListener("wheel", wheel);
  }, [changeZoom]);
  return { viewportRef, timelineRef, zoom, changeZoom };
}
