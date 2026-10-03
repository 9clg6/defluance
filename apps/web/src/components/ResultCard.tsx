"use client";

import Link from "next/link";
import { Fragment } from "react";
import { StatusBadge, TypeBadge } from "@/components/badges";
import { PrivateBadge } from "@/components/PrivateNote";
import { Badge } from "@/components/ui";
import { notePath } from "@/lib/api";
import { highlight } from "@/lib/highlight";
import { useT } from "@/lib/i18n";
import type { SearchHit } from "@/lib/types";

export function Marked({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {highlight(text, terms).map((s, i) => (
        <Fragment key={i}>{s.hit ? <mark>{s.text}</mark> : s.text}</Fragment>
      ))}
    </>
  );
}

/** One note in the results: its best passage with the matched words marked, and optionally more passages. */
export function ResultCard({ hit, terms, onOpen }: { hit: SearchHit; terms: string[]; onOpen?: () => void }) {
  const { t, tr } = useT();
  const how = hit.sources.map((s) => t(s === "fts" ? "result.words" : "result.meaning")).join(" + ");
  const anchor = hit.chunk.heading !== hit.note.title ? hit.chunk.heading.split(" > ").at(-1) : null;
  return (
    <article className="rounded-xl border bg-card p-4">
      <h3 className="flex flex-wrap items-center gap-2 text-base">
        <Link href={notePath(hit.note.id, anchor)} onClick={onOpen} className="font-semibold text-primary underline-offset-2 hover:underline">
          {hit.note.title}
        </Link>
        {hit.private && <PrivateBadge />}
        <TypeBadge type={hit.note.type} />
        <StatusBadge status={hit.note.status} />
        <Badge tone="muted" title={t("result.matchedBy", { how })}>
          {how}
        </Badge>
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">{hit.note.id}</p>
      <p className="mt-2 text-sm leading-relaxed">
        {hit.chunk.heading !== hit.note.title && <strong className="mr-1 font-medium">{hit.chunk.heading} ·</strong>}
        <Marked text={hit.chunk.snippet} terms={terms} />
      </p>
      {hit.more && hit.more.length > 0 && (
        <ul className="mt-2 space-y-1 border-t pt-2 text-sm text-muted-foreground" aria-label={t("result.more")}>
          {hit.more.map((m) => (
            <li key={m.id}>
              <Link href={notePath(hit.note.id, m.heading.split(" > ").at(-1))} onClick={onOpen} className="font-medium text-foreground underline-offset-2 hover:underline">
                {m.heading}
              </Link>{" "}
              · <Marked text={m.snippet} terms={terms} />
            </li>
          ))}
        </ul>
      )}
      <span className="sr-only">{tr("type", hit.note.type ?? "note")}</span>
    </article>
  );
}

