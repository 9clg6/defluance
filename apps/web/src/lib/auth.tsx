"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, UNAUTHORIZED_EVENT } from "./api";
import type { Me } from "./types";

interface AuthState {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState>({ me: null, loading: true, refresh: async () => undefined, logout: async () => undefined });

const PUBLIC = ["/login"];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname() ?? "/";

  const refresh = useCallback(async () => {
    try {
      setMe(await api.get<Me>("/api/v1/me"));
    } catch (e) {
      setMe(null);
      if (!(e instanceof ApiError && e.status === 401)) console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Any 401 sends the person back to the sign-in page.
  useEffect(() => {
    const on = () => {
      setMe(null);
      if (!PUBLIC.some((p) => pathname.startsWith(p))) router.replace("/login/");
    };
    window.addEventListener(UNAUTHORIZED_EVENT, on);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, on);
  }, [pathname, router]);

  useEffect(() => {
    if (!loading && !me && !PUBLIC.some((p) => pathname.startsWith(p))) router.replace("/login/");
  }, [loading, me, pathname, router]);

  const logout = useCallback(async () => {
    await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
    setMe(null);
    router.replace("/login/");
  }, [router]);

  return <Ctx.Provider value={{ me, loading, refresh, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

export const can = (me: Me | null, perm: string, space?: string): boolean =>
  !!me && me.spaces.some((s) => (space === undefined || s.name === space) && s.perms.includes(perm));
