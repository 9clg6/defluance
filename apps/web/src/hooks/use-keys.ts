"use client";

import { useSWRConfig } from "swr";
import { useApi } from "@/hooks/use-api";
import type { KeysResponse } from "@/lib/types";

/** Your keys and which are unlocked, plus the public keys notes can be encrypted for. */
export const useKeys = (enabled = true) => useApi<KeysResponse>(enabled ? "/api/v1/keys" : null);

/**
 * Unlocking or locking a key changes what almost every screen shows (titles, text, search hits), so everything cached is
 * read again afterwards.
 */
export function useRefreshAll() {
  const { mutate } = useSWRConfig();
  return () => mutate(() => true);
}
