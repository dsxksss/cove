import { afterEach, describe, expect, it, vi } from "vitest";
import { invokeNative } from "./native";

describe("native invocation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("preserves Rust string errors as Error messages", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: { invoke: () => Promise.reject("网易云需要登录") } });
    const error = await invokeNative("netease_search").catch((e) => e);
    expect(error instanceof Error).toBe(true);
    expect(error.message).toBe("网易云需要登录");
  });

  it("does not dispatch an already cancelled search", async () => {
    const invoke = vi.fn();
    vi.stubGlobal("window", { __TAURI_INTERNALS__: { invoke } });
    const controller = new AbortController();
    controller.abort();
    const error = await invokeNative("netease_search", {}, controller.signal).catch((e) => e);
    expect(error.name).toBe("AbortError");
    expect(invoke).toHaveBeenCalledTimes(0);
  });

  it("settles on cancellation even when the native request has not finished", async () => {
    let finish!: (value: unknown) => void;
    vi.stubGlobal("window", { __TAURI_INTERNALS__: { invoke: () => new Promise((resolve) => { finish = resolve; }) } });
    const controller = new AbortController();
    const result = invokeNative("netease_search", {}, controller.signal).catch((e) => e);
    controller.abort();
    expect((await result).name).toBe("AbortError");
    finish({ data: [] });
  });
});
