"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";

export interface Resource<T> {
  data: T | undefined;
  error: ApiError | Error | undefined;
  loading: boolean;
  reload: () => Promise<void>;
  set: (v: T) => void;
}

/** Fetch `path` (null = do nothing). Re-fetches when the path changes. Ignores stale responses. */
export function useApi<T>(path: string | null): Resource<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError | Error>();
  const [loading, setLoading] = useState(path !== null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (path === null) return;
    const mine = ++seq.current;
    setLoading(true);
    try {
      const r = await api.get<T>(path);
      if (mine === seq.current) {
        setData(r);
        setError(undefined);
      }
    } catch (e) {
      if (mine === seq.current) {
        setError(e as Error);
        setData(undefined);
      }
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load, set: setData };
}
