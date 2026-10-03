"use client";

import useSWR from "swr";
import { api, ApiError } from "@/lib/api";

export interface Resource<T> {
  data: T | undefined;
  error: ApiError | Error | undefined;
  loading: boolean;
  reload: () => Promise<void>;
  set: (v: T) => void;
}

const fetcher = <T,>(path: string) => api.get<T>(path);

/**
 * Fetch `path` (null = do nothing). SWR de-duplicates identical requests across components (the schema is read by
 * a dozen of them), ignores stale responses, and keeps one cache per address. Focus revalidation stays off:
 * this app edits documents, and data changing under an open editor is worse than slightly old data.
 */
export function useApi<T>(path: string | null): Resource<T> {
  const { data, error, isValidating, mutate } = useSWR<T, ApiError | Error>(path, fetcher<T>, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    dedupingInterval: 2000,
  });
  return {
    data,
    error,
    loading: path !== null && isValidating,
    reload: async () => void (await mutate()),
    set: (v) => void mutate(v, { revalidate: false }),
  };
}
