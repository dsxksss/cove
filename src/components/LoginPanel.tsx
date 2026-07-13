import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Check, Info, Loader2, Minus, RefreshCw, Smartphone, X } from "lucide-react";
import QRCode from "qrcode";
import {
  getLoginStatus,
  type LoginStatus,
} from "../lib/api";
import {
  AUTH_PLATFORM_LABEL,
  AUTH_PLATFORM_SCAN_HINT,
  checkPlatformQr,
  emptyMultiAuth,
  getMultiAuthStatus,
  getPlatformQrKey,
  logoutPlatform,
  type AuthPlatform,
  type MultiAuthStatus,
} from "../lib/auth";
import { closeWindow, minimizeWindow } from "../lib/tauri";

type Phase = "waiting" | "scanned" | "success" | "expired" | "loading";

/**
 * Multi-platform QR login only (NetEase / QQ / Kugou).
 * Compact layout: secondary tips live behind an info hover control.
 * Guest / visitor entry is not supported — need at least one platform login.
 */
export function LoginPanel({
  open,
  onClose,
  onLoggedIn,
  onAuthChange,
  closable = true,
  initialPlatform = "netease",
}: {
  open: boolean;
  onClose: () => void;
  onLoggedIn?: (s: LoginStatus) => void;
  onAuthChange?: (s: MultiAuthStatus) => void;
  closable?: boolean;
  initialPlatform?: AuthPlatform;
}) {
  const [platform, setPlatform] = useState<AuthPlatform>(initialPlatform);
  const [auth, setAuth] = useState<MultiAuthStatus>(emptyMultiAuth);
  const [qrImg, setQrImg] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [err, setErr] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoBox, setInfoBox] = useState<{
    left: number;
    bottom: number;
    maxW: number;
  } | null>(null);
  const pollRef = useRef<AbortController | null>(null);
  /** Bumps on every startLogin / platform switch so stale async cannot overwrite UI. */
  const genRef = useRef(0);
  const platformRef = useRef<AuthPlatform>(platform);
  platformRef.current = platform;
  const infoRef = useRef<HTMLDivElement>(null);
  const infoBtnRef = useRef<HTMLButtonElement>(null);
  const infoPanelRef = useRef<HTMLDivElement>(null);

  const refreshAuth = async () => {
    const st = await getMultiAuthStatus();
    setAuth(st);
    onAuthChange?.(st);
    return st;
  };

  useEffect(() => {
    if (!open) return;
    setPlatform(initialPlatform);
    setErr(null);
    setInfoOpen(false);
    void refreshAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPlatform]);

  useEffect(() => {
    if (!open) {
      pollRef.current?.abort();
      genRef.current += 1; // invalidate in-flight
      return;
    }
    void startLogin(platform);
    return () => {
      pollRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, platform]);

  const placeInfoTip = () => {
    const btn = infoBtnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const margin = 12;
    const maxW = Math.min(300, Math.max(220, window.innerWidth - margin * 2));
    // Prefer anchoring near the button, keep fully on-screen.
    let left = r.right - maxW;
    if (!auth.anyLoggedIn) {
      left = r.left + r.width / 2 - maxW / 2;
    }
    left = Math.min(Math.max(margin, left), window.innerWidth - maxW - margin);
    const bottom = Math.max(margin, window.innerHeight - r.top + 8);
    setInfoBox({ left, bottom, maxW });
  };

  useLayoutEffect(() => {
    if (!infoOpen) {
      setInfoBox(null);
      return;
    }
    placeInfoTip();
    const onReposition = () => placeInfoTip();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infoOpen, auth.anyLoggedIn, platform]);

  useEffect(() => {
    if (!infoOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (infoBtnRef.current?.contains(t)) return;
      if (infoPanelRef.current?.contains(t)) return;
      if (infoRef.current?.contains(t)) return;
      setInfoOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setInfoOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [infoOpen]);

  async function startLogin(p: AuthPlatform, replaceExisting = false) {
    const gen = ++genRef.current;
    pollRef.current?.abort();
    setErr(null);
    setPhase("loading");
    setQrImg(null);
    try {
      // Opening the panel or switching tabs must never destroy an existing
      // platform session. Only the explicit “重新扫码” action may replace it.
      const latest = await getMultiAuthStatus().catch(() => auth);
      if (gen !== genRef.current || platformRef.current !== p) return;
      setAuth(latest);
      onAuthChange?.(latest);
      const existing =
        p === "netease" ? latest.netease : p === "qq" ? latest.qq : latest.kugou;
      if (existing.logged_in && !replaceExisting) {
        setPhase("waiting");
        return;
      }
      if (existing.logged_in && replaceExisting) {
        await logoutPlatform(p).catch(() => {});
        const st = await getMultiAuthStatus().catch(() => emptyMultiAuth());
        setAuth(st);
        onAuthChange?.(st);
      }
      if (gen !== genRef.current || platformRef.current !== p) return;

      const key = await getPlatformQrKey(p);
      // Stale: user switched tab or reopened
      if (gen !== genRef.current || platformRef.current !== p) return;

      let dataUrl: string | null = key.image_base64?.trim() || null;
      // Only encode URL when server did not return a ready image (NetEase / Kugou H5).
      if (!dataUrl && key.url?.trim()) {
        dataUrl = await QRCode.toDataURL(key.url.trim(), {
          width: 220,
          margin: 1,
          color: { dark: "#0b0c10", light: "#ffffff" },
          errorCorrectionLevel: "M",
        });
      }
      if (gen !== genRef.current || platformRef.current !== p) return;
      if (!dataUrl) throw new Error("未能生成二维码图片");

      // Guard: NetEase QR URLs must never render under QQ/Kugou tab
      if (p !== "netease" && key.url?.includes("music.163.com")) {
        throw new Error("二维码串台：拿到了网易云地址，请重试");
      }

      setQrImg(dataUrl);
      setPhase("waiting");
      poll(p, key.unikey, gen);
    } catch (e: any) {
      if (gen !== genRef.current || platformRef.current !== p) return;
      setErr(e?.message ? `无法生成二维码：${e.message}` : "无法生成二维码");
      setPhase("expired");
    }
  }

  function poll(p: AuthPlatform, unikey: string, gen: number) {
    const ctrl = new AbortController();
    pollRef.current = ctrl;
    let failStreak = 0;
    const tick = async () => {
      if (ctrl.signal.aborted) return;
      if (gen !== genRef.current || platformRef.current !== p) return;
      try {
        const s = await checkPlatformQr(p, unikey, ctrl.signal);
        if (gen !== genRef.current || platformRef.current !== p) return;
        failStreak = 0;
        setErr(null);
        if (s.status === "success" || s.code === 803) {
          setPhase("success");
          const multi = await refreshAuth();
          // NetEase keeps legacy callback; all platforms refresh multi-auth above.
          if (p === "netease") {
            try {
              const st = await getLoginStatus();
              onLoggedIn?.(st.logged_in ? st : { ...st, logged_in: true });
            } catch {
              onLoggedIn?.({ logged_in: true });
            }
          } else {
            // Ensure parent multi-auth is updated even if refresh path differs
            onAuthChange?.(multi);
          }
          return;
        }
        if (s.status === "expired" || s.code === 800) {
          setPhase("expired");
          setErr("二维码已过期，请点击重试");
          return;
        }
        if (s.status === "scanned" || s.code === 802) {
          setPhase("scanned");
        } else {
          setPhase("waiting");
        }
        setTimeout(tick, 1000);
      } catch (e: any) {
        if (e?.name === "AbortError" || gen !== genRef.current) return;
        failStreak += 1;
        // Transient network / 403 — keep polling, but surface status so UI isn't "dead"
        if (failStreak >= 2) {
          setErr("正在检测登录状态…（手机确认后请稍候）");
        }
        // Don't flip to expired on transient poll errors
        setTimeout(tick, failStreak > 5 ? 2000 : 1200);
      }
    };
    setTimeout(tick, 800);
  }

  const phaseText = {
    loading: "生成二维码…",
    waiting: "打开对应 App 扫一扫",
    scanned: "已扫码，请在手机上确认",
    success: "登录成功",
    expired: "二维码已过期",
  }[phase];

  const tabs: AuthPlatform[] = ["netease", "qq", "kugou"];
  const currentAuth =
    platform === "netease" ? auth.netease : platform === "qq" ? auth.qq : auth.kugou;

  // Official product app icons (App Store / 应用宝 primary app artwork).
  // Cache-bust when assets change so browsers don't keep stale logos.
  // Solid base + broad brand wash (more saturated / farther flood).
  const PLATFORM_BRAND: Record<
    AuthPlatform,
    { logo: string; solid: string; wash: string }
  > = {
    netease: {
      logo: "/brands/netease.png?v=2",
      solid: "#0c0e14",
      wash:
        "radial-gradient(ellipse 100% 70% at 50% 22%, rgba(236,65,65,0.22) 0%, rgba(236,65,65,0.08) 42%, transparent 70%)," +
        "radial-gradient(ellipse 70% 55% at 8% 100%, rgba(190,24,48,0.14) 0%, transparent 55%)," +
        "linear-gradient(180deg, #121016 0%, #0c0e14 60%, #0c0e14 100%)",
    },
    qq: {
      logo: "/brands/qq.png?v=2",
      solid: "#0c0e14",
      wash:
        "radial-gradient(ellipse 100% 70% at 50% 22%, rgba(49,194,124,0.20) 0%, rgba(49,194,124,0.07) 42%, transparent 70%)," +
        "radial-gradient(ellipse 70% 55% at 8% 100%, rgba(16,185,129,0.12) 0%, transparent 55%)," +
        "linear-gradient(180deg, #0e1411 0%, #0c0e14 60%, #0c0e14 100%)",
    },
    kugou: {
      logo: "/brands/kugou.png?v=3",
      solid: "#0c0e14",
      wash:
        "radial-gradient(ellipse 100% 70% at 50% 22%, rgba(44,166,224,0.20) 0%, rgba(44,166,224,0.07) 42%, transparent 70%)," +
        "radial-gradient(ellipse 70% 55% at 8% 100%, rgba(37,99,235,0.12) 0%, transparent 55%)," +
        "linear-gradient(180deg, #0e1218 0%, #0c0e14 60%, #0c0e14 100%)",
    },
  };
  const brand = PLATFORM_BRAND[platform];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-[60] flex flex-col overflow-hidden text-white"
          style={{ backgroundColor: brand.solid }}
        >
          {/* Full-page brand wash — larger / stronger flood */}
          <AnimatePresence mode="sync">
            <motion.div
              key={platform}
              aria-hidden
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="pointer-events-none absolute inset-0 z-0"
              style={{ background: brand.wash }}
            />
          </AnimatePresence>

          <header
            data-tauri-drag-region
            className="relative z-20 flex h-12 shrink-0 items-center justify-between border-b border-white/10 bg-transparent px-3"
          >
            <span
              data-tauri-drag-region
              className="select-none text-[13px] font-semibold tracking-wide text-white/90"
            >
              扫码登录
            </span>
            <div className="flex items-center gap-0.5 no-drag">
              {closable && (
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={onClose}
                  className="grid h-8 w-8 place-items-center rounded-full text-white/55 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label="关闭登录"
                  title="进入播放器"
                >
                  <X size={15} />
                </button>
              )}
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => void minimizeWindow()}
                className="grid h-8 w-8 place-items-center rounded-full text-white/55 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="最小化窗口"
                title="最小化"
              >
                <Minus size={15} />
              </button>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => void closeWindow()}
                className="grid h-8 w-8 place-items-center rounded-full text-white/55 transition-colors hover:bg-red-500/80 hover:text-white"
                aria-label="关闭窗口"
                title="关闭窗口"
              >
                <X size={15} />
              </button>
            </div>
          </header>

          <div
            data-tauri-drag-region
            className="relative z-10 flex min-h-0 flex-1 flex-col items-center overflow-y-auto bg-transparent px-4 py-3"
          >
            <motion.div
              initial={{ y: 12, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="relative z-10 my-auto flex w-full max-w-[340px] flex-col items-center gap-3 rounded-[26px] border-0 bg-transparent p-4 no-drag shadow-none"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {/* Brand logo — follows selected platform */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={platform}
                  initial={{ opacity: 0, y: 6, scale: 0.92 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.96 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-col items-center gap-1.5"
                >
                  <img
                    src={brand.logo}
                    alt={AUTH_PLATFORM_LABEL[platform]}
                    className="h-11 w-11 rounded-[22%] object-cover shadow-[0_10px_28px_-12px_rgba(0,0,0,0.55)]"
                    draggable={false}
                  />
                  <span className="text-[12px] font-semibold tracking-wide text-white/70">
                    {AUTH_PLATFORM_LABEL[platform]}
                  </span>
                </motion.div>
              </AnimatePresence>

              {/* QQ Music ptlogin requires 手机 QQ (not QQ 音乐 App) — compact tag */}
              <AnimatePresence mode="wait">
                {platform === "qq" &&
                  !(currentAuth.logged_in && phase !== "success" && phase !== "loading") && (
                    <motion.span
                      key="qq-scan-tag"
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.96 }}
                      transition={{ duration: 0.15 }}
                      className="inline-flex items-center gap-1 rounded-full border border-emerald-300/40 bg-emerald-400 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-white shadow-[0_0_16px_-6px_rgba(52,211,153,0.7)]"
                      role="note"
                    >
                      <Smartphone size={11} strokeWidth={2.25} className="shrink-0 text-white" />
                      请用手机 QQ 扫码
                    </motion.span>
                  )}
              </AnimatePresence>

              {/* 1) QR / logged-in card */}
              {currentAuth.logged_in && phase !== "success" && phase !== "loading" ? (
                <div className="flex w-full flex-col items-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-4">
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-emerald-400/20 text-emerald-300">
                    <Check size={20} />
                  </div>
                  <p className="text-center text-[13px] font-semibold text-emerald-200">
                    已登录 · {currentAuth.nickname || currentAuth.uid || "账号"}
                  </p>
                  <button
                    type="button"
                    onClick={() => void startLogin(platform, true)}
                    className="text-[11px] text-white/45 underline-offset-2 hover:text-white hover:underline"
                  >
                    重新扫码
                  </button>
                </div>
              ) : (
                <div className="relative grid aspect-square w-full max-w-[min(220px,46vh)] place-items-center overflow-hidden rounded-[22px] bg-white p-3 shadow-[0_18px_46px_-18px_rgba(0,0,0,0.65)] ring-1 ring-white/70">
                  {qrImg && phase !== "success" ? (
                    <img
                      key={`${platform}-${qrImg.slice(0, 32)}`}
                      src={qrImg}
                      alt={`${AUTH_PLATFORM_LABEL[platform]}登录二维码`}
                      className={`h-full w-full object-contain ${
                        phase === "expired" ? "opacity-30 blur-sm" : ""
                      }`}
                    />
                  ) : phase === "success" ? (
                    <div className="grid place-items-center text-4xl text-emerald-500">✓</div>
                  ) : (
                    <Loader2 className="animate-spin text-slate-400" size={32} />
                  )}
                  {(phase === "expired" || err) && (
                    <button
                      type="button"
                      onClick={() => void startLogin(platform)}
                      className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-black/35 text-xs font-medium text-white"
                    >
                      <RefreshCw size={20} />
                      点击重试
                    </button>
                  )}
                </div>
              )}

              <p
                className={`text-center text-[12px] font-medium leading-snug ${
                  phase === "success"
                    ? "text-emerald-400"
                    : phase === "expired"
                      ? "text-amber-300"
                      : "text-white/65"
                }`}
              >
                {err ?? phaseText}
              </p>

              {/* 2) Platform tabs below QR */}
              <div className="app-liquid-segment grid w-full grid-cols-3 gap-0.5 rounded-xl p-0.5">
                {tabs.map((p) => {
                  const st =
                    p === "netease" ? auth.netease : p === "qq" ? auth.qq : auth.kugou;
                  const active = platform === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        if (p === platform) return;
                        genRef.current += 1;
                        pollRef.current?.abort();
                        setQrImg(null);
                        setPhase("loading");
                        setErr(null);
                        setInfoOpen(false);
                        setPlatform(p);
                      }}
                      className={`relative flex h-9 items-center justify-center gap-1 rounded-lg px-1 text-[11px] font-bold transition-colors ${
                        active
                          ? "bg-white text-slate-950"
                          : "text-white/55 hover:bg-white/8 hover:text-white"
                      }`}
                    >
                      <img
                        src={PLATFORM_BRAND[p].logo}
                        alt=""
                        className={`h-4 w-4 shrink-0 rounded-[4px] object-cover ${
                          active ? "opacity-100" : "opacity-80"
                        }`}
                        draggable={false}
                      />
                      <span className="truncate">{AUTH_PLATFORM_LABEL[p]}</span>
                      {st.logged_in && (
                        <span
                          className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${
                            active ? "bg-emerald-500" : "bg-emerald-400"
                          }`}
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Footer: enter / hint — info always visible (also after one platform is logged in) */}
              <div
                className={`flex w-full items-center gap-1.5 ${
                  auth.anyLoggedIn ? "" : "justify-center"
                }`}
              >
                {auth.anyLoggedIn ? (
                  <button
                    type="button"
                    onClick={onClose}
                    className="app-liquid-control h-10 min-w-0 flex-1 shrink-0 rounded-full text-[13px] font-bold text-white transition-colors"
                  >
                    进入播放器
                  </button>
                ) : (
                  <p className="text-center text-[11px] text-white/35">
                    请先扫码登录任一平台
                  </p>
                )}
                <div ref={infoRef} className="relative shrink-0">
                  <button
                    ref={infoBtnRef}
                    type="button"
                    onClick={() => setInfoOpen((v) => !v)}
                    onMouseEnter={() => setInfoOpen(true)}
                    className={`grid h-5 w-5 place-items-center rounded-full transition-colors ${
                      infoOpen
                        ? "bg-white/14 text-white"
                        : "text-white/40 hover:bg-white/10 hover:text-white/75"
                    }`}
                    aria-label="登录说明"
                    title="登录说明"
                    aria-expanded={infoOpen}
                  >
                    <Info size={12} strokeWidth={2} />
                  </button>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Portal: tip must escape app-liquid-card overflow:hidden / scroll clips */}
          {typeof document !== "undefined" &&
            createPortal(
              <AnimatePresence>
                {infoOpen && infoBox && (
                  <motion.div
                    ref={infoPanelRef}
                    key="login-scan-tip"
                    initial={{ opacity: 0, y: 6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.98 }}
                    transition={{ duration: 0.14 }}
                    className="app-liquid-popover fixed z-[80] rounded-2xl p-3.5 text-left no-drag"
                    style={{
                      left: infoBox.left,
                      bottom: infoBox.bottom,
                      width: infoBox.maxW,
                      maxHeight: "min(280px, calc(100vh - 24px))",
                      overflow: "auto",
                    }}
                    onMouseLeave={() => setInfoOpen(false)}
                  >
                    <p className="text-[11px] font-bold uppercase tracking-wider text-white/40">
                      {AUTH_PLATFORM_LABEL[platform]} · 扫码提示
                    </p>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-white/80">
                      {AUTH_PLATFORM_SCAN_HINT[platform]}
                    </p>
                    <div className="my-2.5 h-px bg-white/10" />
                    <p className="text-[11px] leading-relaxed text-white/50">
                      三个平台各自独立扫码，不会互相共用二维码。绿点表示该平台已登录。
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {(
                        [
                          ["netease", auth.netease],
                          ["qq", auth.qq],
                          ["kugou", auth.kugou],
                        ] as const
                      ).map(([key, st]) => (
                        <span
                          key={key}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                            st.logged_in
                              ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"
                              : "border-white/10 bg-white/5 text-white/40"
                          }`}
                        >
                          {AUTH_PLATFORM_LABEL[key]}
                          {st.logged_in ? " ✓" : ""}
                        </span>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>,
              document.body
            )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
