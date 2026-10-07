import { useEffect, useRef } from "react";
import { ChevronDown, Mic2, Square } from "lucide-react";
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
  onRecord: () => void;
};

export function StudioInputControls(props: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!props.menuOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) props.onMenuChange(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") props.onMenuChange(false); };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [props.menuOpen, props.onMenuChange]);

  const choose = (id: string) => { props.onDeviceChange(id); props.onMenuChange(false); };
  // Windows reports the default device both as an alias and in the device list.
  const devices = props.devices.filter((device) => device.deviceId && device.deviceId !== "default");
  return <section className="min-w-0 space-y-2" aria-label="录音控制">
    <div ref={menuRef} className="relative">
      <button type="button" aria-label="麦克风设备" aria-haspopup="menu" aria-expanded={props.menuOpen}
        disabled={props.recording} onClick={() => props.onMenuChange(!props.menuOpen)}
        title={props.recording ? "停止录音后可切换麦克风" : props.deviceLabel}
        className="flex h-9 w-full min-w-0 items-center gap-2 rounded-xl bg-white/8 px-3 text-left text-xs text-white/75 transition hover:bg-white/12 disabled:opacity-50">
        <Mic2 size={14} className="shrink-0 text-white/40" /><span className="min-w-0 flex-1 truncate">{props.deviceLabel}</span>
        <ChevronDown size={14} className={`shrink-0 transition-transform ${props.menuOpen ? "rotate-180" : ""}`} />
      </button>
      {props.menuOpen && <div role="menu" aria-label="选择麦克风" className="absolute inset-x-0 bottom-full z-[100] mb-2 max-h-56 overflow-y-auto rounded-xl border border-white/12 bg-slate-900 p-1.5 shadow-2xl">
        {[{ deviceId: "default", label: "默认麦克风" }, ...devices].map((device) => <button key={device.deviceId}
          type="button" role="menuitemradio" aria-checked={props.deviceId === device.deviceId}
          onClick={() => choose(device.deviceId)} title={device.label || `麦克风 ${device.deviceId.slice(0, 5)}`}
          className={`block w-full whitespace-normal break-words rounded-lg px-3 py-2.5 text-left text-xs leading-5 transition hover:bg-white/10 ${props.deviceId === device.deviceId ? "bg-lime-200/10 text-lime-100" : "text-white/70"}`}>
          {device.label || `麦克风 ${device.deviceId.slice(0, 5)}`}
        </button>)}
      </div>}
    </div>
    <div className="flex items-center gap-2">
      <div className="min-w-16 flex-1 rounded-lg bg-black/15 px-2 py-1.5" aria-label="麦克风输入电平" title="录音时显示真实输入电平">
        <div className="flex justify-between gap-2 text-[9px] text-white/40"><span>输入</span><span className={props.level.clipping ? "text-red-200" : "text-lime-100/70"}>{props.level.clipping ? "过载" : props.level.rms > 0.01 ? "有声音" : "等待"}</span></div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full transition-[width] ${props.level.clipping ? "bg-red-300" : "bg-lime-200"}`} style={{ width: `${Math.min(100, Math.max(0, props.level.peak * 100))}%` }} /></div>
      </div>
      <button type="button" role="switch" aria-label="录音倒计时" aria-checked={props.countdown} onClick={props.onCountdownChange}
        className={`flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-[10px] font-bold ${props.countdown ? "bg-lime-200/15 text-lime-100" : "bg-white/8 text-white/45"}`}>
        <span className={`relative h-3.5 w-6 rounded-full ${props.countdown ? "bg-lime-200/70" : "bg-white/20"}`}><span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all ${props.countdown ? "left-3" : "left-0.5"}`} /></span>倒计时
      </button>
      <button type="button" onClick={props.onRecord} aria-label={props.recording ? "停止录音" : "开始录音"}
        className={`flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-xs font-bold ${props.recording ? "bg-red-400/20 text-red-100" : "bg-white/10 text-white/80 hover:bg-white/15"}`}>
        {props.recording ? <Square size={13} fill="currentColor" /> : <Mic2 size={14} />}{props.recording ? "停止" : "录音"}
      </button>
    </div>
  </section>;
}
