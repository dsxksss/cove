import { useEffect, type RefObject } from "react";

/**
 * IntersectionObserver: set data-shown="1" when list rows enter the viewport.
 * Rows should use class `list-enter` and optional style `--i` for stagger delay.
 */
export function useListEnter(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  /** Re-bind when list identity changes (length / key). */
  deps: unknown[] = []
) {
  useEffect(() => {
    if (!enabled) return;
    const root = containerRef.current;
    if (!root) return;

    const mark = (el: Element, shown: boolean) => {
      el.setAttribute("data-shown", shown ? "1" : "0");
    };

    // Seed existing rows as hidden then observe
    const rows = root.querySelectorAll(".list-enter");
    rows.forEach((el) => mark(el, false));

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            mark(entry.target, true);
            // Keep shown once revealed (stable lists); still ok to re-hide if needed
          }
        }
      },
      {
        root: root.scrollHeight > root.clientHeight ? root : null,
        rootMargin: "40px 0px",
        threshold: 0.08,
      }
    );

    rows.forEach((el) => io.observe(el));

    // Also watch for dynamically added rows
    const mo = new MutationObserver(() => {
      root.querySelectorAll(".list-enter:not([data-shown])").forEach((el) => {
        mark(el, false);
        io.observe(el);
      });
    });
    mo.observe(root, { childList: true, subtree: true });

    return () => {
      io.disconnect();
      mo.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, containerRef, ...deps]);
}
