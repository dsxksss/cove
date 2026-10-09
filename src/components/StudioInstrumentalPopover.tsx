import { useEffect, useId, useRef, type ReactNode } from "react";
import { AudioLines, LoaderCircle, X } from "lucide-react";

type Props = {
  open: boolean;
  busy: boolean;
  status: string | null;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
};

export function StudioInstrumentalPopover({ open, busy, status, onOpenChange, children }: Props) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const changeRef = useRef(onOpenChange); changeRef.current = onOpenChange;
  useEffect(() => {
    if (!open) return;
    (panel.current?.querySelector<HTMLButtonElement>("button[data-autofocus]:not(:disabled)") ?? panel.current)?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) changeRef.current(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      changeRef.current(false);
      trigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  return <div ref={root} className="relative no-drag shrink-0" onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) onOpenChange(false);
  }}>
    <button ref={trigger} type="button" aria-label="伴奏输入" title={busy && status ? `伴奏输入 · ${status}` : "伴奏输入"}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => onOpenChange(!open)}
      className={`grid h-9 w-9 place-items-center rounded-xl transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-lime-200 ${open ? "bg-lime-200/15 text-lime-100" : "bg-white/10 text-white/65 hover:bg-white/15 hover:text-white"}`}>
      {busy ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" /> : <AudioLines size={17} aria-hidden="true" />}
      {busy && <span className="sr-only">正在处理伴奏，点击查看进度</span>}
    </button>
    {open && <div ref={panel} id={id} role="dialog" aria-label="伴奏输入" tabIndex={-1}
      className="absolute right-0 top-full z-[120] mt-2 max-h-[calc(100vh-96px)] w-80 max-w-[calc(100vw-40px)] space-y-3 overflow-y-auto rounded-2xl border border-white/12 bg-slate-900/95 p-4 shadow-2xl backdrop-blur-xl outline-none">
      <div className="flex items-center justify-between gap-2"><div><h2 className="text-xs font-bold text-white/85">伴奏输入</h2><p className="mt-1 text-[10px] text-white/40">导入音频或重新生成当前歌曲的伴奏</p></div><button type="button" aria-label="关闭伴奏输入" onClick={() => { onOpenChange(false); trigger.current?.focus({ preventScroll: true }); }} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white/40 hover:bg-white/10 hover:text-white"><X size={14} /></button></div>
      {children}
    </div>}
  </div>;
}
