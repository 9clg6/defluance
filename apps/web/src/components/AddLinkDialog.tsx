"use client";

import { useEffect, useState } from "react";
import { suggestNotes } from "@/components/Editor";
import { Button, Dialog, DialogContent, ErrorBox, Field, Input, Select } from "@/components/ui";
import { api, errorMessage, noteApi } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import type { WriteResult } from "@/lib/types";

/** Link this note to another: pick the target by path or title, pick the link type, and the server writes it into the frontmatter. */
export function AddLinkDialog({ id, linkTypes, open, onOpenChange, onAdded }: { id: string; linkTypes: string[]; open: boolean; onOpenChange: (o: boolean) => void; onAdded: () => void }) {
  const { t, tr } = useT();
  const toast = useToast();
  const [target, setTarget] = useState("");
  const [type, setType] = useState("");
  const [options, setOptions] = useState<{ label: string; detail: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const kind = type || linkTypes[0] || "";

  useEffect(() => {
    if (!open) return;
    let stale = false;
    const timer = setTimeout(() => {
      suggestNotes(target.trim())
        .then((o) => !stale && setOptions(o.filter((x) => x.label !== id)))
        .catch(() => !stale && setOptions([]));
    }, 150);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [open, target, id]);

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.post<WriteResult>(`${noteApi(id)}/links`, { to: target.trim(), type: kind });
      toast("ok", t("addlink.added"));
      onOpenChange(false);
      setTarget("");
      onAdded();
    } catch (e) {
      setError(errorMessage(e)); // 409 (already linked, or changed meanwhile) and 422 (no such note or type) read well as they are
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("addlink.addTitle")} description={t("addlink.addHelp")} closeLabel={t("close")}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <Field label={t("addlink.target")} id="addlink-target" hint={t("addlink.targetHint")}>
            <Input id="addlink-target" value={target} onChange={(e) => setTarget(e.target.value)} autoComplete="off" required autoFocus />
          </Field>
          {options.length > 0 && (
            <ul aria-label={t("addlink.suggestions")} className="max-h-40 space-y-1 overflow-y-auto">
              {options.map((o) => (
                <li key={o.label}>
                  <button type="button" onClick={() => setTarget(o.label)} className="flex w-full flex-wrap items-baseline gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm hover:border-primary">
                    <span className="font-medium">{o.detail}</span>
                    <span className="text-xs text-muted-foreground">{o.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Field label={t("addlink.type")} id="addlink-type">
            <Select id="addlink-type" value={kind} onChange={(e) => setType(e.target.value)} className="w-full">
              {linkTypes.map((x) => <option key={x} value={x}>{tr("link", x)}</option>)}
            </Select>
          </Field>
          {error && <ErrorBox>{error}</ErrorBox>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
            <Button type="submit" disabled={busy || !target.trim() || !kind}>{t("addlink.add")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
