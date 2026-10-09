import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Mic2, Plus, Square } from "lucide-react";
import type { StudioInputLevel } from "../lib/studioRecorder";

type Props = {
  devices: MediaDeviceInfo[];
  deviceId: string;
  deviceLabel: string;
  menuOpen: boolean;
  onMenuChange: (open: boolean) => void;
  onDeviceChange: (id: string) => void;
  level: StudioInputLevel;
  countdown: boolean;
  onCountdownChange: () => void;
  recording: boolean;
  saving?: boolean;
  targetName?: string;
  hasVocalTracks: boolean;
  blocked?: boolean;
  onChooseTrack: () => void;
  onRecord: () => void;
};

export function StudioInputControls(props: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const menuChangeRef = useRef(props.onMenuChange); menuChangeRef.current = props.onMenuChange;
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number; width: number; maxHeight: number; transform: string } | null>(null);
  useLayoutEffect(() => {
    if (!props.menuOpen) { setMenuPosition(null); return; }
    const position = () => {
      const anchor = menuRef.current, bounds = anchor?.getBoundingClientRect();
      if (!anchor || !bounds) return;
      let visibleTop = 0, visibleBottom = innerHeight;
      for (let parent = anchor.parentElement; parent; parent = parent.parentElement) {
        if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) {
          const rect = parent.getBoundingClientRect();
          visibleTop = Math.max(visibleTop, rect.top); visibleBottom = Math.min(visibleBottom, rect.bottom);
        }
      }
      if (bounds.bottom <= visibleTop || bounds.top >= visibleBottom) { menuChangeRef.current(false); return; }
      const above = bounds.top - 16, below = innerHeight - bounds.bottom - 16;
      const useAbove = above >= Math.min(224, below);
      const maxHeight = Math.max(40, Math.min(224, useAbove ? above : below));
      const width = Math.min(innerWidth - 24, Math.max(280, bounds.width));
      setMenuPosition({ left: Math.max(12, Math.min(bounds.left, innerWidth - width - 12)), top: useAbove ? bounds.top - 8 : bounds.bottom + 8, width, maxHeight, transform: useAbove ? "translateY(-100%)" : "none" });
    };
    position();
    // Native focus scrolling can finish just after the opening click. Follow
    // the anchor instead of immediately dismissing the newly opened menu.
    const scroll = (event: Event) => { if (!popupRef.current?.contains(event.target as Node)) position(); };
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", position);
    return () => { document.removeEventListener("scroll", scroll, true); window.removeEventListener("resize", position); };
  }, [props.menuOpen]);
  const menuReady = props.menuOpen && !!menuPosition;
  useEffect(() => {
    if (!menuReady) return;
    const selected = popupRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    const item = selected ?? popupRef.current?.querySelector<HTMLButtonElement>("button");
    item?.focus({ preventScroll: true });
    if (item && popupRef.current) popupRef.current.scrollTop = item.offsetTop - popupRef.current.clientHeight / 2 + item.offsetHeight / 2;
  }, [menuReady]);
  const focusTrigger = () => menuRef.current?.querySelector("button")?.focus({ preventScroll: true });
  useEffect(() => {
    if (!props.menuOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !popupRef.current?.contains(event.target as Node)) props.onMenuChange(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { props.onMenuChange(false); focusTrigger(); } };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [props.menuOpen, props.onMenuChange]);

  const choose = (id: string) => { if (props.recording || props.saving) return; props.onDeviceChange(id); props.onMenuChange(false); focusTrigger(); };
  // Windows reports the default device both as an alias and in the device list.
  const devices = props.devices.filter((device) => device.deviceId && device.deviceId !== "default");
  if (!props.targetName && !props.recording) return <section aria-label="录音控制" className="rounded-xl border border-dashed border-white/15 bg-white/[0.025] p-3">
    <div className="mb-2 flex items-center gap-2 text-xs font-bold text-white/60"><Mic2 size={14} />录音</div>
    <p className="mb-3 text-[11px] leading-5 text-white/40">{props.hasVocalTracks ? "选中人声轨后再录音，伴奏和参考轨用于试听。" : "先新建一条人声轨，再选择麦克风开始录音。"}</p>
    <button type="button" disabled={props.blocked || props.saving} onClick={props.onChooseTrack} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-lime-200/10 px-3 py-2 text-xs font-bold text-lime-100 hover:bg-lime-200/20 disabled:opacity-40"><Plus size={13} />{props.hasVocalTracks ? "选择人声轨" : "新建人声轨"}</button>
  </section>;
  return <section className="min-w-0 space-y-2" aria-label="录音控制">
    <div className="flex min-w-0 items-center gap-2 text-[10px] text-white/40"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${props.recording ? "animate-pulse bg-red-300" : "bg-sky-300"}`} /><span className="shrink-0">{props.recording ? "正在录制" : "录音到"}</span><span className="truncate font-bold text-white/70" title={props.targetName}>{props.targetName}</span></div>
    <div ref={menuRef} className="relative">
      <button type="button" aria-label="麦克风设备" aria-haspopup="menu" aria-expanded={props.menuOpen}
        disabled={props.recording} onClick={() => props.onMenuChange(!props.menuOpen)}
        title={props.recording ? "停止录音后可切换麦克风" : props.deviceLabel}
        className="flex h-9 w-full min-w-0 items-center gap-2 rounded-xl bg-white/8 px-3 text-left text-xs text-white/75 transition hover:bg-white/12 disabled:opacity-50">
        <Mic2 size={14} className="shrink-0 text-white/40" /><span className="min-w-0 flex-1 truncate">{props.deviceLabel}</span>
        <ChevronDown size={14} className={`shrink-0 transition-transform ${props.menuOpen ? "rotate-180" : ""}`} />
      </button>
      {props.menuOpen && !props.recording && menuPosition && createPortal(<div ref={popupRef} role="menu" aria-label="选择麦克风" style={menuPosition} onKeyDown={(event) => {
        if (event.key === "Tab") { props.onMenuChange(false); focusTrigger(); return; }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const items = Array.from(popupRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }} className="fixed z-[200] overflow-y-auto overscroll-y-contain rounded-xl border border-white/12 bg-slate-900 p-1.5 shadow-2xl">
        {[{ deviceId: "default", label: "默认麦克风" }, ...devices].map((device) => <button key={device.deviceId}
          type="button" role="menuitemradio" aria-checked={props.deviceId === device.deviceId}
          onClick={() => choose(device.deviceId)} title={device.label || `麦克风 ${device.deviceId.slice(0, 5)}`}
          className={`block w-full whitespace-normal break-words rounded-lg px-3 py-2.5 text-left text-xs leading-5 transition hover:bg-white/10 ${props.deviceId === device.deviceId ? "bg-lime-200/10 text-lime-100" : "text-white/70"}`}>
          {device.label || `麦克风 ${device.deviceId.slice(0, 5)}`}
        </button>)}
      </div>, document.body)}
    </div>
    <div className="flex items-center gap-2">
      <div className="min-w-16 flex-1 rounded-lg bg-black/15 px-2 py-1.5" aria-label="麦克风输入电平" title="录音时显示真实输入电平">
        <div className="flex justify-between gap-2 text-[9px] text-white/40"><span>输入</span><span className={props.level.clipping ? "text-red-200" : "text-lime-100/70"}>{props.level.clipping ? "过载" : props.level.rms > 0.01 ? "有声音" : "等待"}</span></div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full transition-[width] ${props.level.clipping ? "bg-red-300" : "bg-lime-200"}`} style={{ width: `${Math.min(100, Math.max(0, props.level.peak * 100))}%` }} /></div>
      </div>
      <button type="button" role="switch" aria-label="录音倒计时" disabled={props.recording} aria-checked={props.countdown} onClick={props.onCountdownChange}
        className={`flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-[10px] font-bold disabled:opacity-50 ${props.countdown ? "bg-lime-200/15 text-lime-100" : "bg-white/8 text-white/45"}`}>
        <span className={`relative h-3.5 w-6 rounded-full ${props.countdown ? "bg-lime-200/70" : "bg-white/20"}`}><span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all ${props.countdown ? "left-3" : "left-0.5"}`} /></span>倒计时
      </button>
      <button type="button" disabled={props.saving || (!props.recording && props.blocked)} onClick={props.onRecord} aria-label={props.saving ? "正在保存录音" : props.recording ? "停止录音" : "开始录音"}
        className={`flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-xs font-bold disabled:opacity-40 ${props.recording ? "bg-red-400/20 text-red-100" : "bg-red-400/10 text-red-100 hover:bg-red-400/20"}`}>
        {props.recording ? <Square size={13} fill="currentColor" /> : <Mic2 size={14} />}{props.saving ? "保存中" : props.recording ? "停止" : "录音"}
      </button>
    </div>
  </section>;
}
