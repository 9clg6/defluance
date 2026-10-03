"use client";

import { MessageCircleQuestion } from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { Badge, Button, ErrorBox, Input } from "@/components/ui";
import { api, errorMessage, notePath } from "@/lib/api";
import { useT } from "@/lib/i18n";
import type { AskResult } from "@/lib/types";

/** Answers always come with their sources: each `[n]` points to the cited passage below. */
export function AskPanel({ scopeNote, initialQuestion }: { scopeNote?: string | undefined; initialQuestion?: string | undefined }) {
  const { t } = useT();
  const [q, setQ] = useState(initialQuestion ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AskResult>();
  const [error, setError] = useState<string>();
  const auto = useRef(false);

  const run = async (question: string) => {
    if (!question.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      setResult(await api.post<AskResult>("/api/v1/ask", { question: question.trim(), ...(scopeNote ? { scope_note: scopeNote, scope_depth: 1 } : {}) }));
    } catch (e) {
      setResult(undefined);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (initialQuestion && !auto.current) {
      auto.current = true;
      void run(initialQuestion);
    }
    // run once for the question given in the URL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  const withMarkers = (text: string) =>
    text.split(/(\[\d+\])/g).map((part, i) => {
      const m = /^\[(\d+)\]$/.exec(part);
      return m ? (
        <sup key={i}>
          <a href={`#cite-${m[1]}`} className="px-0.5 font-medium text-primary underline" aria-label={t("ask.source", { n: m[1] as string })}>
            {m[1]}
          </a>
        </sup>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      );
    });

  return (
    <section aria-labelledby="ask-title" className="space-y-4">
      <h2 id="ask-title" className="flex items-center gap-2 font-heading text-lg font-semibold">
        <MessageCircleQuestion className="size-5" aria-hidden />
        {scopeNote ? t("ask.titleNote") : t("ask.title")}
      </h2>
      {scopeNote && <p className="text-sm text-muted-foreground">{t("ask.scope")}</p>}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(q);
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ask.placeholder")} aria-label={t("ask.placeholder")} />
        <Button type="submit" disabled={busy || !q.trim()}>
          {busy ? t("ask.thinking") : t("ask.submit")}
        </Button>
      </form>
      {error && <ErrorBox>{error}</ErrorBox>}
      {result && (
        <div className="space-y-3" aria-live="polite">
          {result.refused ? (
            <p className="rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-sm">{t("ask.refused")}</p>
          ) : (
            <>
              <p className="whitespace-pre-wrap leading-relaxed">{withMarkers(result.answer)}</p>
              {result.mode === "extractive" && <p className="text-xs text-muted-foreground">{t("ask.extractive")}</p>}
              <ol className="space-y-2" aria-label={t("ask.sources")}>
                {result.citations.map((c) => (
                  <li key={c.n} id={`cite-${c.n}`} className="rounded-lg border p-3 text-sm target:ring-2 target:ring-ring">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="primary">{c.n}</Badge>
                      <Link href={notePath(c.note, c.heading !== c.title ? c.heading.split(" > ").at(-1) : null)} className="font-medium text-primary underline underline-offset-2">
                        {c.title}
                      </Link>
                      {c.heading !== c.title && <span className="text-muted-foreground">› {c.heading}</span>}
                      {c.commit && <code className="ml-auto text-xs text-muted-foreground">{c.commit.slice(0, 7)}</code>}
                    </div>
                    <p className="mt-1 text-muted-foreground">{c.snippet}</p>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </section>
  );
}
