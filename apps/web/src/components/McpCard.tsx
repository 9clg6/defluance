"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { CopyButton } from "@/components/CopyButton";
import { Card, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { mcpSnippets } from "@/lib/mcp";

const noSubscribe = () => () => undefined;
/** The server's address: empty while rendering for the static export, so the first client render matches it. */
const useOrigin = () => useSyncExternalStore(noSubscribe, () => window.location.origin, () => "");

/** How to connect an agent to this server: one snippet per client, with the token left as a placeholder. */
export function McpCard() {
  const { t } = useT();
  const origin = useOrigin();
  const snippets = mcpSnippets(`${origin}/mcp`);
  const tabs = [
    { id: "claude", code: snippets.claude },
    { id: "json", code: snippets.json },
    { id: "stdio", code: snippets.stdio },
  ] as const;
  const link = "text-primary underline underline-offset-2";
  const [pre, mid, post] = t("mcp.note", { tokens: "|T|", drafts: "|D|" }).split(/\|[TD]\|/);

  return (
    <section aria-labelledby="mcp-title">
      <Card className="space-y-3">
        <div>
          <h2 id="mcp-title" className="font-heading text-xl font-semibold">{t("mcp.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("mcp.help")}</p>
        </div>
        <Tabs defaultValue="claude">
          <TabsList aria-label={t("mcp.title")}>
            {tabs.map((x) => <TabsTrigger key={x.id} value={x.id}>{t(`mcp.${x.id}`)}</TabsTrigger>)}
          </TabsList>
          {tabs.map((x) => (
            <TabsContent key={x.id} value={x.id} className="space-y-2 pt-3">
              <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs"><code>{x.code}</code></pre>
              <CopyButton text={x.code} label={t("mcp.copy", { what: t(`mcp.${x.id}`) })} />
            </TabsContent>
          ))}
        </Tabs>
        <p className="text-xs text-muted-foreground">{t("mcp.placeholder")}</p>
        <p className="text-sm">
          {pre}<Link href="/settings/?tab=tokens" className={link}>{t("mcp.tokensLink")}</Link>{mid}<Link href="/drafts/" className={link}>{t("mcp.draftsLink")}</Link>{post}
        </p>
      </Card>
    </section>
  );
}
