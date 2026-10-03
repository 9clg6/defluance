"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { GraphView } from "@/components/GraphView";
import { Card, ErrorBox, Select, Spinner } from "@/components/ui";
import { useApi } from "@/hooks/use-api";
import { errorMessage, notePath } from "@/lib/api";
import { useT } from "@/lib/i18n";
import type { Subgraph, VaultSchema } from "@/lib/types";

export default function GraphPage() {
  return (
    <Suspense fallback={null}>
      <GraphContent />
    </Suspense>
  );
}

function GraphContent() {
  const { t, tr } = useT();
  const params = useSearchParams();
  const router = useRouter();
  const overview = useApi<Subgraph>("/api/v1/graph/overview?limit=300");
  const lint = useApi<{ orphans: string[]; broken: { from: string; target: string; line: number }[] }>("/api/v1/graph/lint");
  const schema = useApi<VaultSchema>("/api/v1/schema");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [link, setLink] = useState("");
  const [showLint, setShowLint] = useState(() => params.has("lint"));

  const filtered = useMemo<Subgraph | undefined>(() => {
    const g = overview.data;
    if (!g) return undefined;
    const nodes = g.nodes.filter((n) => (!type || n.type === type) && (!status || n.status === status));
    const ids = new Set(nodes.map((n) => n.id));
    return { nodes, edges: g.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && (!link || e.type === link)), truncated: g.truncated };
  }, [overview.data, type, status, link]);

  return (
    <div className="space-y-4">
      <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("graph.title")}</h1>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="f-type" className="mb-1 block text-xs text-muted-foreground">{t("note.type")}</label>
          <Select id="f-type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">{t("graph.all")}</option>
            {Object.keys(schema.data?.types ?? {}).filter((x) => x !== "issue" && x !== "pull-request").map((x) => <option key={x} value={x}>{tr("type", x)}</option>)}
          </Select>
        </div>
        <div>
          <label htmlFor="f-status" className="mb-1 block text-xs text-muted-foreground">{t("note.status")}</label>
          <Select id="f-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("graph.all")}</option>
            {schema.data?.statuses.map((x) => <option key={x} value={x}>{tr("status", x)}</option>)}
          </Select>
        </div>
        <div>
          <label htmlFor="f-link" className="mb-1 block text-xs text-muted-foreground">{t("graph.linkType")}</label>
          <Select id="f-link" value={link} onChange={(e) => setLink(e.target.value)}>
            <option value="">{t("graph.all")}</option>
            {schema.data?.linkTypes.map((x) => <option key={x} value={x}>{tr("link", x)}</option>)}
          </Select>
        </div>
        <button type="button" className="ml-auto text-sm text-primary underline underline-offset-2" aria-expanded={showLint} onClick={() => setShowLint((v) => !v)}>
          {t("graph.lint")}
        </button>
      </div>

      {overview.loading && <Spinner label={t("loading")} />}
      {overview.error && <ErrorBox>{errorMessage(overview.error)}</ErrorBox>}
      {filtered && (filtered.nodes.length ? <GraphView graph={filtered} onOpen={(id) => router.push(notePath(id))} height={560} /> : <p className="text-muted-foreground">{t("graph.empty")}</p>)}

      {showLint && lint.data && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <h2 className="mb-2 text-sm font-semibold">{t("graph.orphans", { n: lint.data.orphans.length })}</h2>
            <ul className="space-y-1 text-sm">
              {lint.data.orphans.map((id) => <li key={id}><a className="text-primary underline" href={notePath(id)}>{id}</a></li>)}
            </ul>
          </Card>
          <Card>
            <h2 className="mb-2 text-sm font-semibold">{t("graph.broken", { n: lint.data.broken.length })}</h2>
            <ul className="space-y-1 text-sm">
              {lint.data.broken.map((b, i) => <li key={i}><a className="text-primary underline" href={notePath(b.from)}>{b.from}</a> → <code>{b.target}</code> ({t("graph.line", { n: b.line })})</li>)}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
