"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import type { IndexStatus } from "@/lib/types";

const DISMISSED = "dfl-hide-words-hint";

/**
 * Two things people should know about search: vectors still being prepared (with progress),
 * and, when no meaning model is set up, that search only matches words.
 */
export function StatusBanners() {
  const { t } = useT();
  const { me } = useAuth();
  const [status, setStatus] = useState<IndexStatus>();
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    try {
      setHidden(localStorage.getItem(DISMISSED) === "1");
    } catch {
      setHidden(false);
    }
  }, []);

  const busy = !!status && (status.embedding.running || (status.capabilities.semantic && status.embedding.pending > 0 && !status.embedding.error));
  useEffect(() => {
    if (!me) return;
    let stop = false;
    const load = () =>
      api
        .get<IndexStatus>("/api/v1/index/status")
        .then((s) => !stop && setStatus(s))
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, busy ? 2000 : 60_000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [me, busy]);

  if (!status) return null;
  const e = status.embedding;
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {
      // the hint comes back next time: harmless
    }
  };

  return (
    <div className="border-b bg-muted/50 text-sm">
      {status.capabilities.semantic && e.error && (
        <p role="status" className="mx-auto max-w-[88rem] px-4 py-2 text-warning">
          {t("banner.embeddingError", { error: e.error })}
        </p>
      )}
      {busy && !e.error && (
        <div role="status" className="mx-auto flex max-w-[88rem] items-center gap-3 px-4 py-2">
          <span>{e.total > 0 ? t("banner.embedding", { done: e.done.toLocaleString(), total: e.total.toLocaleString() }) : t("banner.embeddingWaiting")}</span>
          {e.total > 0 && <progress className="h-2 w-40" max={e.total} value={e.done} aria-label={t("banner.embeddingWaiting")} />}
        </div>
      )}
      {!status.capabilities.semantic && !hidden && (
        <div className="mx-auto flex max-w-[88rem] items-start gap-3 px-4 py-2">
          <p className="flex-1 text-muted-foreground">{t("banner.words")}</p>
          <button type="button" onClick={dismiss} aria-label={t("banner.dismiss")} className="rounded-md p-1 hover:bg-muted">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
