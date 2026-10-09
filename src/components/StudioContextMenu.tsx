import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";

export type StudioMenuItem = { id: string; label: string; action: () => void; disabled?: boolean; checked?: boolean; danger?: boolean; separator?: boolean; hint?: string };

export function StudioContextMenu({ x, y, title, items, onClose }: { x: number; y: number; title: string; items: StudioMenuItem[]; onClose: (restoreFocus?: boolean) => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(x, innerWidth - rect.width - 8)), top: Math.max(8, Math.min(y, innerHeight - rect.height - 8)) });
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside = (event: PointerEvent) => { if (!menu.contains(event.target as Node)) closeRef.current(false); };
    const dismiss = () => closeRef.current(false);
    const scroll = (event: Event) => { if (!menu.contains(event.target as Node)) dismiss(); };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", dismiss); window.addEventListener("blur", dismiss);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("scroll", scroll, true); window.removeEventListener("resize", dismiss); window.removeEventListener("blur", dismiss); };
  }, [x, y]);
  return createPortal(<div ref={menuRef} role="menu" aria-label="音轨右键菜单" onContextMenu={event => event.preventDefault()}
    onKeyDown={event => {
      if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); event.stopPropagation(); onClose(true); return; }
      if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const controls = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const index = controls.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? controls.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + controls.length) % controls.length;
      controls[next]?.focus();
    }} style={position} className="fixed z-[300] max-h-[calc(100vh-16px)] w-60 overflow-y-auto overscroll-y-contain rounded-xl border border-white/15 bg-slate-900 p-1.5 text-xs text-white/80 shadow-2xl">
    <p className="truncate px-3 py-2 text-[10px] font-bold text-white/35" title={title}>{title}</p>
    {items.map(item => <div key={item.id} className={item.separator ? "mt-1 border-t border-white/10 pt-1" : undefined}>
      <button type="button" aria-label={item.label} role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"} aria-checked={item.checked} disabled={item.disabled} onClick={() => { onClose(true); item.action(); }}
        className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left outline-none hover:bg-white/10 focus:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30 ${item.danger ? "text-red-200" : ""}`}>
        <span className="grid w-3 shrink-0 place-items-center">{item.checked && <Check size={12} />}</span><span className="flex-1">{item.label}</span>{item.hint && <span className="text-[10px] text-white/30">{item.hint}</span>}
      </button>
    </div>)}
  </div>, document.body);
}
