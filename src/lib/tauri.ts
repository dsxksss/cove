/** Safe Tauri window controls — no-op outside Tauri (browser dev). */

const RUNNING_IN_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function minimizeWindow() {
  if (!RUNNING_IN_TAURI) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().minimize();
  } catch {
    /* ignore */
  }
}

export async function closeWindow() {
  if (!RUNNING_IN_TAURI) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  } catch {
    /* ignore */
  }
}

export async function toggleMaximize() {
  if (!RUNNING_IN_TAURI) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const w = getCurrentWindow();
    // maximize is enough for a fixed-ish player; toggling is nicer
    if (await w.isMaximized()) await w.unmaximize();
    else await w.maximize();
  } catch {
    /* ignore */
  }
}

export const inTauri = RUNNING_IN_TAURI;
