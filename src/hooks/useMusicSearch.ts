import { useEffect, useState } from "react";
import { searchMusic } from "../lib/musicSources";
import type { MusicSource, Song } from "../lib/types";

type SearchState = {
  key: string;
  results: Song[];
  loading: boolean;
  error: string | null;
};

/** Results belong to an exact query/source, including during the debounce. */
export function useMusicSearch(query: string, source: MusicSource, enabled: boolean) {
  const keyword = query.trim();
  const key = enabled && keyword ? JSON.stringify([source, keyword]) : "";
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SearchState>({ key: "", results: [], loading: false, error: null });

  useEffect(() => {
    if (!key) {
      setState({ key: "", results: [], loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    setState({ key, results: [], loading: true, error: null });
    const timer = setTimeout(async () => {
      try {
        const songs = await searchMusic(keyword, source, 40, controller.signal);
        if (!controller.signal.aborted) {
          setState({ key, results: songs, loading: false, error: null });
        }
      } catch (error: unknown) {
        if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : String(error);
          setState({ key, results: [], loading: false, error: `搜索失败：${message}` });
        }
      }
    }, 380);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, keyword, source, attempt]);

  // Hide stale data synchronously, before the next effect has run.
  const current = key && state.key === key ? state : null;
  return {
    results: current?.results ?? [],
    loading: !!key && (!current || current.loading),
    error: current?.error ?? null,
    retry: () => setAttempt((value) => value + 1),
  };
}
