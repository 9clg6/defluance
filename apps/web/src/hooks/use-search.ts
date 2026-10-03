"use client";

import { useEffect, useRef, useState } from "react";
import { api, errorMessage, qs } from "@/lib/api";
import type { SearchHit, SearchMode, SmartResult, Understood } from "@/lib/types";

export interface SearchParams {
  q: string;
  mode: SearchMode;
  type?: string | undefined;
  status?: string | undefined;
  limit?: number;
  passages?: number;
  /** Wait this long after the last change before asking the server. */
  debounce?: number;
}

export interface SearchState {
  hits: SearchHit[];
  understood?: Understood | undefined;
  loading: boolean;
  error?: string | undefined;
  /** The query these results answer (results of an older query are never shown for a newer one). */
  forQuery: string;
}

/** One entry point for every search mode. Ignores answers that arrive late for an older query. */
export function useSearch({ q, mode, type, status, limit = 12, passages = 1, debounce = 0 }: SearchParams): SearchState {
  const [state, setState] = useState<SearchState>({ hits: [], loading: false, forQuery: "" });
  const seq = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setState({ hits: [], loading: false, forQuery: "" });
      return;
    }
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    const timer = setTimeout(async () => {
      try {
        if (mode === "smart") {
          const r = await api.get<SmartResult>(`/api/v1/search/smart${qs({ q: query, type, status, limit, passages })}`);
          if (mine === seq.current) setState({ hits: r.hits, understood: r.understood, loading: false, forQuery: query });
        } else {
          const hits = await api.get<SearchHit[]>(`/api/v1/search${qs({ q: query, mode, type, status, limit, passages })}`);
          if (mine === seq.current) setState({ hits, loading: false, forQuery: query });
        }
      } catch (e) {
        if (mine === seq.current) setState({ hits: [], loading: false, error: errorMessage(e), forQuery: query });
      }
    }, debounce);
    return () => clearTimeout(timer);
  }, [q, mode, type, status, limit, passages, debounce]);

  return state;
}
