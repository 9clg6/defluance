"use client";

import { CircleDot, GitPullRequest, Plus } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/badges";
import { Badge, Button } from "@/components/ui";
import { notePath } from "@/lib/api";
import { useT } from "@/lib/i18n";
import type { LinkView, NoteLinks } from "@/lib/types";

const STATE_TONE = { open: "success", merged: "primary", closed: "muted" } as const;

function GithubRef({ l }: { l: LinkView }) {
  const { t } = useT();
  const key = l.target.replace(/^gh:/, "");
  const gh = l.github;
  const Icon = gh?.kind === "pull-request" ? GitPullRequest : CircleDot;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      {gh?.url ? (
        <a href={gh.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline underline-offset-2">
          {key}
        </a>
      ) : (
        <span>{key}</span>
      )}
      {gh ? <Badge tone={STATE_TONE[gh.state]}>{t(`gh.${gh.state}`)}</Badge> : <Badge tone="muted">{t("gh.unsynced")}</Badge>}
      {gh && <span className="text-sm text-muted-foreground">{gh.title}</span>}
    </span>
  );
}

/** `onAdd` shows the Add link button (people who can write); `addHint` explains why it is disabled. */
export function LinksPanel({ links, onAdd, addHint }: { links: NoteLinks; onAdd?: () => void; addHint?: string }) {
  const { t, tr } = useT();
  const out = Object.entries(links.outgoing);
  const inc = Object.entries(links.incoming);

  return (
    <div className="space-y-5">
      <section aria-labelledby="links-out">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 id="links-out" className="text-sm font-semibold">
            {t("links.outgoing")}
          </h3>
          {onAdd && (
            <Button size="sm" variant="outline" onClick={onAdd} disabled={!!addHint} title={addHint}>
              <Plus className="size-4" aria-hidden />
              {t("addlink.add")}
            </Button>
          )}
        </div>
        {out.length === 0 && <p className="text-sm text-muted-foreground">{t("links.none")}</p>}
        {out.map(([type, items]) => (
          <div key={type} className="mb-3">
            <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{tr("link", type)}</h4>
            <ul className="space-y-1.5 text-sm">
              {items.map((l, i) => (
                <li key={`${l.target}-${i}`}>
                  {l.kind === "github" ? (
                    <GithubRef l={l} />
                  ) : l.note ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <Link href={notePath(l.note.id, l.heading)} className="font-medium text-primary underline underline-offset-2">
                        {l.note.title}
                      </Link>
                      <StatusBadge status={l.note.status} />
                    </span>
                  ) : (
                    <span className="text-destructive" title={t("link.broken")}>
                      {l.target} <span className="text-xs">({t("link.broken")})</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section aria-labelledby="links-in">
        <h3 id="links-in" className="mb-2 text-sm font-semibold">
          {t("links.incoming")}
        </h3>
        {inc.length === 0 && <p className="text-sm text-muted-foreground">{t("links.none")}</p>}
        {inc.map(([type, items]) => (
          <div key={type} className="mb-3">
            <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{tr("link", type)}</h4>
            <ul className="space-y-1.5 text-sm">
              {items.map((l, i) => (
                <li key={`${l.from.id}-${i}`} className="flex flex-wrap items-center gap-2">
                  <Link href={notePath(l.from.id)} className="font-medium text-primary underline underline-offset-2">
                    {l.from.title}
                  </Link>
                  <StatusBadge status={l.from.status} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
