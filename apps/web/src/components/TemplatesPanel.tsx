"use client";

import { useState } from "react";
import { Badge, Button, Card, Dialog, DialogContent, ErrorBox, Field, Input, Spinner, Textarea } from "@/components/ui";
import { useApi } from "@/hooks/use-api";
import { api, errorMessage } from "@/lib/api";
import { can, useAuth } from "@/lib/auth";
import { TEMPLATE_NAME } from "@/lib/generate";
import { useT } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import type { TemplateItem } from "@/lib/types";

const TONE = { builtin: "muted", override: "primary", vault: "success" } as const;
const url = (name: string) => `/api/v1/templates/${encodeURIComponent(name)}`;

/** The templates new notes start from. Everybody who can read sees them; only administrators change them. */
export function TemplatesPanel() {
  const { t } = useT();
  const { me } = useAuth();
  const toast = useToast();
  const list = useApi<{ items: TemplateItem[] }>("/api/v1/templates");
  const admin = can(me, "admin");
  const [picked, setPicked] = useState<string>();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [name, setName] = useState("");

  const items = list.data?.items ?? [];
  const current = items.find((i) => i.name === picked) ?? items[0];
  const text = current ? (edits[current.name] ?? current.content) : "";
  const dirty = !!current && text !== current.content;
  const nameBad = name !== "" && !TEMPLATE_NAME.test(name);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      await list.reload();
    } catch (e) {
      setError(errorMessage(e)); // 422: the server says what is wrong with the template
    } finally {
      setBusy(false);
    }
  };

  const drop = (n: string) => setEdits((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== n)));

  const save = (n: string, content: string, after?: () => void) =>
    run(async () => {
      const r = await api.put<{ name: string; commit: string }>(url(n), { content });
      toast("ok", t("tpl.saved", { commit: r.commit.slice(0, 7) }));
      drop(n);
      after?.();
    });

  const remove = () =>
    current &&
    run(async () => {
      await api.del(url(current.name));
      toast("ok", t(current.source === "override" ? "tpl.reverted" : "tpl.deleted"));
      drop(current.name);
      setConfirm(false);
      setPicked(undefined);
    });

  if (list.loading && !list.data) return <Spinner label={t("loading")} />;
  if (list.error) return <ErrorBox>{errorMessage(list.error)}</ErrorBox>;

  return (
    <div className="space-y-5">
      <div className="max-w-3xl space-y-2 text-sm text-muted-foreground">
        <p>{t("tpl.help")}</p>
        <p>{t("tpl.hint")}</p>
        {!admin && <p>{t("tpl.readOnly")}</p>}
      </div>

      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label={t("tpl.list")}>
          <ul className="space-y-1.5">
            {items.map((i) => (
              <li key={i.name}>
                <button
                  type="button"
                  aria-current={i.name === current?.name ? "true" : undefined}
                  onClick={() => { setPicked(i.name); setError(undefined); }}
                  className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-left text-sm hover:border-primary aria-[current=true]:border-primary aria-[current=true]:ring-1 aria-[current=true]:ring-primary"
                >
                  <span className="font-medium">{i.name}</span>
                  <Badge tone={TONE[i.source]}>{t(`tpl.${i.source}`)}</Badge>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {current && (
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-heading text-lg font-semibold">{current.name}</h2>
              <Badge tone={TONE[current.source]}>{t(`tpl.${current.source}`)}</Badge>
            </div>
            <Field label={t("tpl.edit")} id="tpl-text">
              <Textarea id="tpl-text" value={text} readOnly={!admin} onChange={(e) => setEdits({ ...edits, [current.name]: e.target.value })} rows={18} spellCheck={false} className="font-mono text-xs" />
            </Field>
            {error && <ErrorBox>{error}</ErrorBox>}
            {admin && (
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy || !dirty} onClick={() => void save(current.name, text)}>{t("tpl.save")}</Button>
                {current.source !== "builtin" && (
                  <Button variant="outline" disabled={busy} onClick={() => setConfirm(true)}>
                    {current.source === "override" ? t("tpl.revert") : t("tpl.delete")}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {admin && (
        <Card className="max-w-xl">
          <h2 className="mb-3 font-heading text-lg font-semibold">{t("tpl.new")}</h2>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void save(name, t("tpl.starter"), () => { setPicked(name); setName(""); });
            }}
          >
            <Field label={t("tpl.name")} id="tpl-name" hint={nameBad ? undefined : t("tpl.nameHint")}>
              <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} className="w-56" aria-invalid={nameBad} aria-describedby={nameBad ? "tpl-name-bad" : undefined} />
              {nameBad && <p id="tpl-name-bad" className="mt-1 text-xs text-destructive">{t("tpl.nameInvalid")}</p>}
            </Field>
            <Button type="submit" disabled={busy || !TEMPLATE_NAME.test(name)}>{t("tpl.create")}</Button>
          </form>
        </Card>
      )}

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent
          title={current?.source === "override" ? t("tpl.confirmRevertTitle") : t("tpl.confirmDeleteTitle")}
          description={current ? t(current.source === "override" ? "tpl.confirmRevertBody" : "tpl.confirmDeleteBody", { name: current.name }) : undefined}
          closeLabel={t("close")}
        >
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirm(false)}>{t("cancel")}</Button>
            <Button variant="destructive" disabled={busy} onClick={() => void remove()}>{t("tpl.confirm")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
