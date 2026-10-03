"use client";

import { Lock } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { TreeView, type TreeNode } from "@/components/arc/tree-view/tree-view";
import { EmptyState, Input, PageAlert, PageSkeleton } from "@/components/ui";
import { useApi } from "@/hooks/use-api";
import { errorMessage, notePath } from "@/lib/api";
import { buildTree, type VaultNode } from "@/lib/tree";
import { useT } from "@/lib/i18n";
import type { NoteSummary } from "@/lib/types";

const decorate = (nodes: VaultNode[]): TreeNode[] =>
  nodes.map((n) => ({ id: n.id, label: n.label, ...(n.children ? { children: decorate(n.children) } : {}), ...(n.private ? { icon: <Lock className="size-4" aria-hidden /> } : {}) }));

export default function VaultPage() {
  return (
    <Suspense fallback={null}>
      <Vault />
    </Suspense>
  );
}

function Vault() {
  const { t } = useT();
  const initial = useSearchParams().get("q") ?? "";
  const router = useRouter();
  const tree = useApi<{ notes: NoteSummary[]; truncated: boolean }>("/api/v1/tree");
  const [filter, setFilter] = useState(initial);
  const built = useMemo(() => {
    const b = buildTree(tree.data?.notes ?? [], filter);
    return { ...b, nodes: decorate(b.nodes), top: b.nodes.filter((n) => n.children).map((n) => n.id) };
  }, [tree.data, filter]);

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("vault.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("vault.intro")}</p>
      </header>
      {tree.loading && !tree.data && <PageSkeleton label={t("loading")} />}
      {tree.error && <PageAlert title={t("error.title")}>{errorMessage(tree.error)}</PageAlert>}
      {tree.data && (
        <>
          <Input type="search" aria-label={t("vault.filter")} placeholder={t("vault.filter")} value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-md" />
          {tree.data.truncated && <p className="text-xs text-muted-foreground">{t("vault.truncated")}</p>}
          {built.nodes.length === 0 ? (
            <EmptyState title={t("vault.none")} description={t("vault.intro")} />
          ) : (
            // a new key when the filter changes: the tree opens the folders that hold a match
            <TreeView key={filter ? `f:${filter}` : "all"} aria-label={t("vault.tree")} nodes={built.nodes} defaultExpandedIds={filter ? built.open : built.top} onSelect={(n) => n.id.startsWith("note:") && router.push(notePath(n.id.slice(5)))} />
          )}
        </>
      )}
    </div>
  );
}
