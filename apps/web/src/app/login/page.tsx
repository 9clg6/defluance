"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, ErrorBox, Input, Label } from "@/components/ui";
import { TextStream } from "@/components/block/text-stream";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import type { Me } from "@/lib/types";

interface AuthConfig {
  oauth: boolean;
  local: boolean;
}

export default function LoginPage() {
  const { t, lang, setLang } = useT();
  const { refresh, me } = useAuth();
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<AuthConfig>();
  const tried = useRef(false);

  const signIn = async (value: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await api.post<Me>("/auth/token-login", { token: value.trim() });
      await refresh();
      router.replace("/");
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? t("login.invalid") : t("login.failed"));
      setBusy(false);
    }
  };

  useEffect(() => {
    fetch("/auth/config")
      .then((r) => r.json() as Promise<AuthConfig>)
      .then(setConfig)
      .catch(() => undefined);
    // `defluance serve` prints /login#token=...: use it, then drop it from the address bar.
    const m = /[#&]token=([^&]+)/.exec(window.location.hash);
    if (m && !tried.current) {
      tried.current = true;
      history.replaceState(null, "", window.location.pathname);
      void signIn(decodeURIComponent(m[1] as string));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (me) router.replace("/");
  }, [me, router]);

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden items-center justify-center overflow-hidden border-r bg-muted/40 lg:flex" aria-hidden>
        <TextStream items={[t("login.s1"), t("login.s2"), t("login.s3"), t("login.s4")]} prefix={t("login.prefix")} height="100%" fontSize="clamp(2.5rem, 4.5vw, 4rem)" paused={false} />
      </section>
      <main id="main" className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight">Defluance</h1>
            <p className="mt-2 text-muted-foreground">{t("login.tagline")}</p>
          </div>

          {config?.oauth && (
            <Button className="w-full" onClick={() => (window.location.href = "/auth/github/login")}>
              {t("login.github")}
            </Button>
          )}

          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void signIn(token);
            }}
          >
            <div>
              <Label htmlFor="token">{t("login.token")}</Label>
              <Input id="token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="dfl_…" required />
              <p className="mt-1 text-xs text-muted-foreground">{config?.local ? t("login.tokenHintLocal") : t("login.tokenHint")}</p>
            </div>
            {error && <ErrorBox>{error}</ErrorBox>}
            <Button type="submit" variant={config?.oauth ? "outline" : "default"} className="w-full" disabled={busy || !token.trim()}>
              {t("login.submit")}
            </Button>
          </form>

          <button type="button" className="text-sm text-muted-foreground underline underline-offset-2" onClick={() => setLang(lang === "en" ? "fr" : "en")}>
            {lang === "en" ? "Français" : "English"}
          </button>
        </div>
      </main>
    </div>
  );
}
