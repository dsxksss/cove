import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Loader2, RefreshCw, X } from "lucide-react";
import QRCode from "qrcode";
import { checkQrLogin, getQrKey, getLoginStatus, type LoginStatus } from "../lib/api";

/**
 * QR login panel: shows a QR code, polls /qr/check, and reports success when
 * the Netease_url server accepts the login.
 */
export function LoginPanel({
  open,
  onClose,
  onLoggedIn,
  closable = true,
}: {
  open: boolean;
  onClose: () => void;
  onLoggedIn?: (s: LoginStatus) => void;
  closable?: boolean;
}) {
  const [qrImg, setQrImg] = useState<string | null>(null);
  const [phase, setPhase] = useState<"waiting" | "scanned" | "success" | "expired" | "loading">("loading");
  const [err, setErr] = useState<string | null>(null);
  const pollRef = useRef<AbortController | null>(null);

  // generate a fresh QR when opened
  useEffect(() => {
    if (!open) return;
    void startLogin();
    return () => pollRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function startLogin() {
    setErr(null);
    setPhase("loading");
    setQrImg(null);
    pollRef.current?.abort();
    try {
      const key = await getQrKey();
      // render the QR code locally as a data URL (no network dependency)
      const dataUrl = await QRCode.toDataURL(key.url, {
        width: 200,
        margin: 1,
        color: { dark: "#0b0c10", light: "#ffffff" },
        errorCorrectionLevel: "M",
      });
      setQrImg(dataUrl);
      setPhase("waiting");
      poll(key.unikey);
    } catch (e: any) {
      setErr(e?.message ? `无法生成二维码：${e.message}` : "无法生成二维码");
    }
  }

  function poll(unikey: string) {
    const ctrl = new AbortController();
    pollRef.current = ctrl;
    const tick = async () => {
      if (ctrl.signal.aborted) return;
      try {
        const s = await checkQrLogin(unikey, ctrl.signal);
        if (s.status === "success" || s.code === 803) {
          setPhase("success");
          // confirm via login/status
          try {
            const st = await getLoginStatus();
            onLoggedIn?.(st);
          } catch {
            onLoggedIn?.({ logged_in: true });
          }
          return;
        }
        if (s.status === "expired" || s.code === 800) {
          setPhase("expired");
          return;
        }
        if (s.status === "scanned" || s.code === 802) setPhase("scanned");
        else setPhase("waiting");
        setTimeout(tick, 2000);
      } catch (e: any) {
        if (e?.name !== "AbortError") setTimeout(tick, 3000);
      }
    };
    setTimeout(tick, 1500);
  }

  const phaseText = {
    loading: "正在生成二维码…",
    waiting: "请用网易云音乐 APP 扫码登录",
    scanned: "已扫码，请在手机上确认登录",
    success: "登录成功！",
    expired: "二维码已过期",
  }[phase];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={closable ? onClose : undefined}
          className="absolute inset-0 z-[60] grid place-items-center bg-black/60 backdrop-blur-sm"
        >
          <motion.div
            initial={{ y: 12, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 8, opacity: 0, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 300, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
            className="w-[340px] rounded-2xl bg-slate-950/90 ring-1 ring-white/10 shadow-2xl overflow-hidden"
          >
            <header className="flex items-center justify-between px-5 h-12 border-b border-white/10">
              <span className="font-semibold text-white text-sm">扫码登录网易云</span>
              {closable && (
                <button
                  onClick={onClose}
                  className="grid place-items-center w-7 h-7 rounded-full text-white/50 hover:text-white hover:bg-white/10"
                >
                  <X size={15} />
                </button>
              )}
            </header>

            <div className="p-6 flex flex-col items-center gap-4">
              {/* QR code area */}
              <div className="relative w-[200px] h-[200px] rounded-xl bg-white p-2 grid place-items-center">
                {qrImg && phase !== "success" ? (
                  <img
                    src={qrImg}
                    alt="登录二维码"
                    className={`w-full h-full ${phase === "expired" ? "opacity-30 blur-sm" : ""}`}
                  />
                ) : (
                  <Loader2 className="animate-spin text-slate-400" size={32} />
                )}
                {phase === "expired" && (
                  <button
                    onClick={() => void startLogin()}
                    className="absolute inset-0 grid place-items-center bg-black/30 rounded-xl text-white text-sm font-medium flex-col gap-2"
                  >
                    <RefreshCw size={22} />
                    点击刷新
                  </button>
                )}
                {phase === "success" && (
                  <div className="absolute inset-0 grid place-items-center text-emerald-500 text-4xl">
                    ✓
                  </div>
                )}
              </div>

              <p
                className={`text-sm text-center ${
                  phase === "success"
                    ? "text-emerald-400"
                    : phase === "expired"
                    ? "text-amber-300"
                    : "text-white/70"
                }`}
              >
                {err ?? phaseText}
              </p>

              {phase === "success" && (
                <p className="text-xs text-white/45 text-center leading-relaxed">
                  登录已完成，正在进入应用。
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
