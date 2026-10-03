"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Dialog, DialogContent, ErrorBox, Field, Input, Select } from "@/components/ui";
import { useApi } from "@/hooks/use-api";
import { useKeys } from "@/hooks/use-keys";
import { api, errorMessage, notePath } from "@/lib/api";
import { slugFromTitle } from "@/lib/frontmatter";
import { useT } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import type { Me, VaultSchema, WriteResult } from "@/lib/types";

export function CreateNote({ open, onOpenChange, initialTitle }: { open: boolean; onOpenChange: (o: boolean) => void; initialTitle?: string }) {
  const { t, tr } = useT();
  const router = useRouter();
  const toast = useToast();
  const schema = useApi<VaultSchema>(open ? "/api/v1/schema" : null);
  const me = useApi<Me>(open ? "/api/v1/me" : null);
  const [title, setTitle] = useState(initialTitle ?? "");
  const [type, setType] = useState("note");
  const [folder, setFolder] = useState("");
  const keys = useKeys(open);
  const [isPrivate, setIsPrivate] = useState(false);
  const [extra, setExtra] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const hasKey = (keys.data?.mine.length ?? 0) > 0;
  const others = (keys.data?.keyring ?? []).filter((k) => !keys.data?.mine.some((m) => m.fp === k.fp));

  useEffect(() => {
    if (open) setTitle(initialTitle ?? "");
  }, [open, initialTitle]);

  const writable = (me.data?.spaces ?? []).filter((s) => s.perms.includes("write"));
  const slug = slugFromTitle(title);
  const id = `${folder ? `${folder.replace(/^\/+|\/+$/g, "")}/` : ""}${slug}`;

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.post<WriteResult>("/api/v1/notes", { type, title: title.trim(), id, ...(isPrivate ? { private: true, recipients: extra } : {}) });
      toast("ok", t("note.created", { id: r.id }));
      onOpenChange(false);
      router.push(`${notePath(r.id)}?tab=edit`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("note.new")} description={t("note.newHelp")} closeLabel={t("close")}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label={t("note.title")} id="new-title">
            <Input id="new-title" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
          </Field>
          <Field label={t("note.type")} id="new-type">
            <Select id="new-type" value={type} onChange={(e) => setType(e.target.value)} className="w-full">
              {Object.keys(schema.data?.types ?? { note: 1 })
                .filter((x) => x !== "issue" && x !== "pull-request")
                .map((x) => (
                  <option key={x} value={x}>
                    {tr("type", x)}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t("note.folder")} id="new-folder" hint={writable.length ? t("note.folderHint", { spaces: writable.filter((s) => s.path).map((s) => s.path).join(", ") || "-" }) : undefined}>
            <Input id="new-folder" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder={writable.find((s) => s.path)?.path ?? ""} />
          </Field>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isPrivate} disabled={!hasKey} onChange={(e) => setIsPrivate(e.target.checked)} />
              {t("private.createLabel")}
            </label>
            {keys.data && !hasKey && <p className="text-xs text-muted-foreground">{t("private.createNeedsKey")}</p>}
            {isPrivate && others.length > 0 && (
              <fieldset className="space-y-1 pl-6">
                <legend className="mb-1 text-xs text-muted-foreground">{t("private.alsoFor")}</legend>
                {others.map((k) => (
                  <label key={k.fp} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={extra.includes(k.fp)} onChange={(e) => setExtra((x) => (e.target.checked ? [...x, k.fp] : x.filter((f) => f !== k.fp)))} />
                    {k.label} <span className="text-xs text-muted-foreground">· {k.owner.replace(/^(user|token):/, "")}</span>
                  </label>
                ))}
              </fieldset>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("note.path")}: <code>{id || "…"}.md</code>
          </p>
          {error && <ErrorBox>{error}</ErrorBox>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={busy || !slug}>
              {t("note.create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
