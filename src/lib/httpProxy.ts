/**
 * Cross-origin HTTP via Tauri backend (same role as Folia's /api/lyric-proxy).
 * Falls back to browser fetch when not in Tauri (dev browser may hit CORS).
 */

export type ProxyResult = {
  status: number;
  contentType: string;
  bodyText?: string;
  bodyBase64?: string;
};

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function httpProxy(options: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  binary?: boolean;
}): Promise<ProxyResult> {
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    // Tauri 2: command args match Rust struct field names on the `args` param.
    return invoke<ProxyResult>("http_proxy", {
      args: {
        url: options.url,
        method: options.method ?? "GET",
        headers: options.headers ?? null,
        body: options.body ?? null,
        binary: options.binary ?? false,
      },
    });
  }

  // Browser fallback (often blocked by CORS for QQ/Kugou).
  const res = await fetch(options.url, {
    method: options.method ?? "GET",
    headers: options.headers,
    body: options.body,
    credentials: "omit",
  });
  const contentType = res.headers.get("content-type") ?? "";
  if (options.binary) {
    const buf = new Uint8Array(await res.arrayBuffer());
    let binary = "";
    for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
    return {
      status: res.status,
      contentType,
      bodyBase64: btoa(binary),
    };
  }
  return {
    status: res.status,
    contentType,
    bodyText: await res.text(),
  };
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
