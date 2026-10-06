import { inTauri } from "./tauri";

/** Native move/size boundaries, including cancellation. No per-move IPC. */
export function observeWindowInteraction(onChange: (active: boolean) => void) {
  let disposed = false;
  let unlisten: (() => void) | undefined;
  if (inTauri) {
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const stop = await getCurrentWindow().listen<boolean>(
        "cove://window-interaction",
        ({ payload }) => { if (!disposed) onChange(payload); },
      );
      if (disposed) stop();
      else unlisten = stop;
    }).catch((error) => console.warn("无法监听窗口移动状态", error));
  }
  return () => {
    disposed = true;
    unlisten?.();
  };
}
