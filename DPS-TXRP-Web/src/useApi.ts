import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

/** Loads JSON from the API. Returns [data, error, reload]. */
export function useApi<T>(path: string | null): [T | undefined, string | undefined, () => void] {
  const [result, setResult] = useState<{ path: string; data?: T; error?: string }>();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    api<T>(path)
      .then((data) => live && setResult({ path, data }))
      .catch((e) => live && setResult({ path, error: e.message }));
    return () => {
      live = false;
    };
  }, [path, tick]);
  const reload = useCallback(() => setTick((value) => value + 1), []);
  return [result?.path === path ? result.data : undefined, result?.path === path ? result.error : undefined, reload];
}
