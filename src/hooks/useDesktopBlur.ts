import { useCallback, useEffect, useRef, useState } from "react";
import { invokeNative } from "../lib/native";

const KEY = "nmp.desktopBlur";
// Serialize native writes, including StrictMode startup and quick toggles.
let nativeTail: Promise<void> = Promise.resolve();

function loadPreference() {
  try { return localStorage.getItem(KEY) !== "0"; } catch { return true; }
}

export function useDesktopBlur() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const apply = useCallback((value: boolean) => {
    const token = ++generation.current;
    setBusy(true);
    setError(null);
    nativeTail = nativeTail.catch(() => undefined).then(() =>
      invokeNative("set_desktop_blur", { enabled: value }),
    );
    void nativeTail.then(() => {
      if (generation.current !== token) return;
      setEnabled(value);
      try { localStorage.setItem(KEY, value ? "1" : "0"); } catch { /* ignore */ }
    }, (cause: unknown) => {
      if (generation.current !== token) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (generation.current === token) setBusy(false);
    });
  }, []);

  useEffect(() => {
    apply(loadPreference());
    return () => { generation.current += 1; };
  }, [apply]);

  return { enabled, busy, error, apply };
}
