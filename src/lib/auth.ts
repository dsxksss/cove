/**
 * Multi-platform auth (NetEase / QQ / Kugou) — QR scan only.
 * Sessions live in the Tauri backend (AppData cookie files).
 */

export type AuthPlatform = "netease" | "qq" | "kugou";

export interface PlatformAuth {
  platform: AuthPlatform;
  logged_in: boolean;
  nickname?: string;
  uid?: string;
  vip?: boolean;
}

export interface MultiAuthStatus {
  anyLoggedIn: boolean;
  netease: PlatformAuth;
  qq: PlatformAuth;
  kugou: PlatformAuth;
}

/** Unified QR key for all platforms. */
export interface PlatformQrKey {
  unikey: string;
  /** When non-empty, encode this URL as the QR image on the client. */
  url: string;
  /** Server-rendered QR image (data URL). Preferred over `url` when present. */
  image_base64?: string | null;
}

export interface PlatformQrStatus {
  code: number;
  status: "waiting" | "scanned" | "success" | "expired" | "unknown";
  saved?: boolean;
  nickname?: string;
}

const EMPTY_PLATFORM = (platform: AuthPlatform): PlatformAuth => ({
  platform,
  logged_in: false,
});

export function emptyMultiAuth(): MultiAuthStatus {
  return {
    anyLoggedIn: false,
    netease: EMPTY_PLATFORM("netease"),
    qq: EMPTY_PLATFORM("qq"),
    kugou: EMPTY_PLATFORM("kugou"),
  };
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invokeNative<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T | null> {
  if (!isTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

function mapPlatform(raw: any, fallback: AuthPlatform): PlatformAuth {
  return {
    platform: (raw?.platform as AuthPlatform) || fallback,
    logged_in: Boolean(raw?.logged_in),
    nickname: raw?.nickname ? String(raw.nickname) : undefined,
    uid: raw?.uid != null ? String(raw.uid) : undefined,
    vip: raw?.vip != null ? Boolean(raw.vip) : undefined,
  };
}

function mapMulti(raw: any): MultiAuthStatus {
  const netease = mapPlatform(raw?.netease, "netease");
  const qq = mapPlatform(raw?.qq, "qq");
  const kugou = mapPlatform(raw?.kugou, "kugou");
  return {
    anyLoggedIn: Boolean(
      raw?.any_logged_in ?? raw?.anyLoggedIn ?? (netease.logged_in || qq.logged_in || kugou.logged_in)
    ),
    netease,
    qq,
    kugou,
  };
}

function mapQrStatus(raw: any): PlatformQrStatus {
  const code = Number(raw?.code ?? 0);
  let status = String(raw?.status ?? "unknown") as PlatformQrStatus["status"];
  if (code === 803) status = "success";
  else if (code === 802) status = "scanned";
  else if (code === 801) status = "waiting";
  else if (code === 800) status = "expired";
  return {
    code,
    status,
    saved: Boolean(raw?.saved),
    nickname: raw?.nickname ? String(raw.nickname) : undefined,
  };
}

/** Full multi-platform auth snapshot. */
export async function getMultiAuthStatus(): Promise<MultiAuthStatus> {
  try {
    const native = await invokeNative<any>("auth_status");
    if (native) return mapMulti(native);
  } catch {
    /* fall through */
  }
  try {
    const { getLoginStatus } = await import("./api");
    const st = await getLoginStatus();
    const netease: PlatformAuth = {
      platform: "netease",
      logged_in: st.logged_in,
      nickname: st.nickname,
      uid: st.uid != null ? String(st.uid) : undefined,
      vip: st.vip_type != null ? st.vip_type > 0 : undefined,
    };
    return {
      anyLoggedIn: netease.logged_in,
      netease,
      qq: EMPTY_PLATFORM("qq"),
      kugou: EMPTY_PLATFORM("kugou"),
    };
  } catch {
    return emptyMultiAuth();
  }
}

/** Fetch a QR key for the given platform. */
export async function getPlatformQrKey(platform: AuthPlatform): Promise<PlatformQrKey> {
  if (platform === "netease") {
    const { getQrKey } = await import("./api");
    const key = await getQrKey();
    return { unikey: key.unikey, url: key.url, image_base64: null };
  }
  if (platform === "qq") {
    const res = await invokeNative<any>("qq_qr_key");
    if (!res) throw new Error("QQ 扫码需要桌面端");
    const image = res.image_base64 ? String(res.image_base64) : null;
    const url = String(res.url ?? "");
    // Never accept a NetEase-shaped payload on the QQ path
    if (url.includes("music.163.com") || url.includes("163.com/login")) {
      throw new Error("QQ 登录接口异常（串到网易云），请重试");
    }
    if (!image && !url) throw new Error("QQ 未返回二维码");
    return {
      unikey: String(res.unikey ?? ""),
      url: "", // QQ always uses server-rendered PNG, not a client-encoded URL
      image_base64: image,
    };
  }
  const res = await invokeNative<any>("kugou_qr_key");
  if (!res) throw new Error("酷狗扫码需要桌面端");
  return {
    unikey: String(res.unikey ?? ""),
    url: String(res.url ?? ""),
    image_base64: res.image_base64 ? String(res.image_base64) : null,
  };
}

/** Poll QR login status for the given platform. */
export async function checkPlatformQr(
  platform: AuthPlatform,
  unikey: string,
  signal?: AbortSignal
): Promise<PlatformQrStatus> {
  if (platform === "netease") {
    const { checkQrLogin } = await import("./api");
    const s = await checkQrLogin(unikey, signal);
    return {
      code: s.code,
      status: s.status,
      saved: s.saved,
    };
  }
  if (signal?.aborted) {
    const err = new Error("Aborted");
    err.name = "AbortError";
    throw err;
  }
  const cmd = platform === "qq" ? "qq_qr_check" : "kugou_qr_check";
  const res = await invokeNative<any>(cmd, { args: { unikey } });
  if (!res) throw new Error("扫码轮询需要桌面端");
  return mapQrStatus(res);
}

export async function logoutQq(): Promise<void> {
  await invokeNative("qq_logout");
}

export async function logoutKugou(): Promise<void> {
  await invokeNative("kugou_logout");
}

export async function logoutNetease(): Promise<void> {
  if (isTauriRuntime()) {
    await invokeNative<void>("netease_logout");
    return;
  }
  const { logout } = await import("./api");
  await logout();
}

export async function logoutPlatform(platform: AuthPlatform): Promise<void> {
  if (platform === "netease") await logoutNetease();
  else if (platform === "qq") await logoutQq();
  else await logoutKugou();
}

export async function logoutAll(): Promise<void> {
  // Tauri commands returning `()` resolve to null. Runtime detection must be
  // explicit or the slow web /logout fallback runs after native cleanup.
  if (isTauriRuntime()) {
    await invokeNative<void>("auth_logout_all");
    return;
  }
  await logoutNetease().catch(() => {});
}

export const AUTH_PLATFORM_LABEL: Record<AuthPlatform, string> = {
  netease: "网易云音乐",
  qq: "QQ音乐",
  kugou: "酷狗音乐",
};

export const AUTH_PLATFORM_SCAN_HINT: Record<AuthPlatform, string> = {
  netease: "打开「网易云音乐」APP → 左侧「扫一扫」→ 扫描上方二维码（不要用 QQ 扫）",
  // ptlogin 二维码需用手机 QQ / 微信扫，不是网易云 APP
  qq: "用手机「QQ」扫一扫（不是网易云 / 不是 QQ 音乐内扫一扫）→ 在 QQ 里点确认授权登录",
  kugou: "打开「酷狗音乐」APP → 扫一扫 → 扫描上方二维码",
};
