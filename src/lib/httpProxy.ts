/**
 * Cross-origin HTTP via Tauri backend (same role as Folia's /api/lyric-proxy).
 * Desktop-only; the Rust command enforces host/method/size allowlists.
 */
import { invokeNative } from "./native";

export type ProxyResult = {
  status: number;
  contentType: string;
  bodyText?: string;
  bodyBase64?: string;
};

export async function httpProxy(options: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  binary?: boolean;
}): Promise<ProxyResult> {
  return invokeNative<ProxyResult>("http_proxy", {
      args: {
        url: options.url,
        method: options.method ?? "GET",
        headers: options.headers ?? null,
        body: options.body ?? null,
        binary: options.binary ?? false,
      },
    });
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
