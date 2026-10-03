"use client";

import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, DialogContent, ErrorBox, Field, Input, Select, Textarea } from "@/components/ui";
import { useApi } from "@/hooks/use-api";
import { api, errorMessage, noteApi } from "@/lib/api";
import { useT } from "@/lib/i18n";
import type { GithubStatus, Me } from "@/lib/types";

interface Created {
  key: string;
  url: string;
  link: { commit?: string; branch?: string | null; error?: string };
}

export function IssueDialog({ id, title, space, open, onOpenChange, onCreated }: { id: string; title: string; space: string; open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const { t } = useT();
  const me = useApi<Me>(open ? "/api/v1/me" : null);
  const gh = useApi<GithubStatus>(open ? "/api/v1/github/status" : null);
  const [repo, setRepo] = useState("");
  const [heading, setHeading] = useState(title);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<Created>();

  const spaceRepos = me.data?.spaces.find((s) => s.name === space)?.repos ?? [];
  const repos = spaceRepos.length ? spaceRepos : (gh.data?.defaultRepos ?? []);
  const chosen = repo || repos[0] || "";

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      setDone(await api.post<Created>(`${noteApi(id)}/issues`, { repo: chosen, title: heading, ...(body.trim() ? { body } : {}) }));
      onCreated();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setDone(undefined); onOpenChange(o); }}>
      <DialogContent title={t("issue.title")} description={t("issue.help")} closeLabel={t("close")}>
        {done ? (
          <div className="space-y-3 text-sm">
            <p>{t("issue.created", { key: done.key })}</p>
            <a href={done.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2">
              {done.url} <ExternalLink className="size-3.5" aria-hidden />
            </a>
            {done.link.error ? <ErrorBox>{t("issue.linkFailed", { error: done.link.error })}</ErrorBox> : <p className="text-muted-foreground">{done.link.branch ? t("issue.linkedBranch", { branch: done.link.branch }) : t("issue.linked")}</p>}
            <div className="flex justify-end">
              <Button onClick={() => onOpenChange(false)}>{t("close")}</Button>
            </div>
          </div>
        ) : !gh.loading && gh.data && !gh.data.configured ? (
          <ErrorBox>{t("issue.notConfigured")}</ErrorBox>
        ) : (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <Field label={t("issue.repo")} id="issue-repo">
              {repos.length ? (
                <Select id="issue-repo" value={chosen} onChange={(e) => setRepo(e.target.value)} className="w-full">
                  {repos.map((r) => <option key={r}>{r}</option>)}
                </Select>
              ) : (
                <Input id="issue-repo" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo" />
              )}
            </Field>
            <Field label={t("issue.heading")} id="issue-heading">
              <Input id="issue-heading" value={heading} onChange={(e) => setHeading(e.target.value)} required />
            </Field>
            <Field label={t("issue.body")} id="issue-body" hint={t("issue.bodyHint")}>
              <Textarea id="issue-body" value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>
            {error && <ErrorBox>{error}</ErrorBox>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
              <Button type="submit" disabled={busy || !chosen || !heading.trim()}>{t("issue.submit")}</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
