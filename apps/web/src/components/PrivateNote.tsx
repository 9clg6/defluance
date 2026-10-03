"use client";

import { KeyRound, Lock, LockOpen, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Badge, Button, Dialog, DialogContent, ErrorBox, Field, Input, Select } from "@/components/ui";
import { useKeys, useRefreshAll } from "@/hooks/use-keys";
import { api, errorMessage, noteApi } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import type { KeyringEntry, NoteDetail, Recipient, WriteResult } from "@/lib/types";

export function PrivateBadge() {
  const { t } = useT();
  return (
    <Badge tone="primary">
      <Lock className="mr-1 size-3" aria-hidden />
      {t("private.badge")}
    </Badge>
  );
}

/** Ask for the passphrase of one of your keys and unlock it. */
export function UnlockForm({ fps, onDone }: { fps?: string[]; onDone?: () => void }) {
  const { t } = useT();
  const toast = useToast();
  const keys = useKeys();
  const refresh = useRefreshAll();
  const mine = (keys.data?.mine ?? []).filter((k) => k.bound === "passphrase" && (!fps || fps.includes(k.fp)));
  const [fp, setFp] = useState<string>();
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const chosen = fp ?? mine[0]?.fp;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!chosen) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.post(`/api/v1/keys/${chosen}/unlock`, { passphrase });
      setPassphrase("");
      toast("ok", t("private.unlocked"));
      await refresh();
      onDone?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!mine.length) return null;
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3">
      {mine.length > 1 && (
        <Field label={t("private.keys")} id="unlock-key">
          <Select id="unlock-key" className="w-full" value={chosen} onChange={(e) => setFp(e.target.value)}>
            {mine.map((k) => (
              <option key={k.fp} value={k.fp}>{k.label}</option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={`${t("private.passphrase")}${mine.length === 1 ? ` · ${mine[0]?.label}` : ""}`} id="unlock-passphrase">
        <Input id="unlock-passphrase" type="password" autoComplete="off" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} required />
      </Field>
      {error && <ErrorBox>{error}</ErrorBox>}
      <Button type="submit" disabled={busy || !passphrase}>
        <LockOpen className="size-4" aria-hidden />
        {t("private.unlock")}
      </Button>
    </form>
  );
}

/** What a private note shows when its text cannot be read: why, and what to do about it. */
export function LockedNote({ note }: { note: NoteDetail }) {
  const { t } = useT();
  return (
    <section aria-labelledby="locked-title" className="mx-auto max-w-lg space-y-4 rounded-[var(--arc-radius-panel)] border bg-card p-6 shadow-[var(--arc-shadow-resting)]">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-muted" aria-hidden>
          <Lock className="size-5" />
        </span>
        <h2 id="locked-title" className="font-heading text-lg font-semibold">{t("private.lockedTitle")}</h2>
      </div>
      {note.reason === "locked" && (
        <>
          <p className="text-sm text-muted-foreground">{t("private.lockedBody")}</p>
          <UnlockForm {...(note.keys ? { fps: note.keys } : {})} />
        </>
      )}
      {note.reason === "no-key" && (
        <>
          <p className="text-sm text-muted-foreground">{t("private.noKeyBody")}</p>
          <Link href="/settings/?tab=private" className="inline-flex items-center gap-2 text-sm text-primary underline">
            <KeyRound className="size-4" aria-hidden />
            {t("private.openSettings")}
          </Link>
        </>
      )}
      {note.reason === "not-recipient" && (
        <>
          <p className="text-sm text-muted-foreground">{t("private.notRecipientBody")}</p>
          <ul className="list-disc pl-5 text-sm">
            {(note.recipients ?? []).map((r) => (
              <li key={r.fp}>{r.label}{r.owner ? <span className="text-muted-foreground"> · {r.owner.replace(/^(user|token):/, "")}</span> : null}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

const who = (e: KeyringEntry | Recipient) => ("owner" in e && e.owner ? `${e.label} · ${e.owner.replace(/^(user|token):/, "")}` : e.label);

/** Who can read a private note, with the means to change it (needs an unlocked key). */
export function RecipientsPanel({ note, writable, onChanged }: { note: NoteDetail; writable: boolean; onChanged: () => void }) {
  const { t } = useT();
  const toast = useToast();
  const keys = useKeys();
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const recipients = note.recipients ?? [];
  const candidates = (keys.data?.keyring ?? []).filter((k) => !recipients.some((r) => r.fp === k.fp));
  const canEdit = writable && !note.locked;

  const change = async (body: { add?: string[]; remove?: string[] }) => {
    setBusy(true);
    setError(undefined);
    try {
      await api.put(`${noteApi(note.id)}/recipients`, body);
      toast("ok", t("private.recipientsChanged"));
      setChoice("");
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="recipients-title" className="space-y-2">
      <h2 id="recipients-title" className="flex items-center gap-1.5 text-sm font-semibold">
        <ShieldCheck className="size-4" aria-hidden />
        {t("private.recipients")}
      </h2>
      <ul className="space-y-1 text-sm">
        {recipients.map((r) => (
          <li key={r.fp} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate" title={r.fp}>{who(r)}</span>
            {canEdit && recipients.length > 1 && (
              <Button size="sm" variant="ghost" disabled={busy} aria-label={t("private.remove", { name: r.label })} onClick={() => void change({ remove: [r.fp] })}>
                ×
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && recipients.length > 1 && <p className="text-xs text-muted-foreground">{t("private.removeWarn")}</p>}
      {canEdit && candidates.length > 0 && (
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor="add-recipient" className="mb-1 block text-xs text-muted-foreground">{t("private.addRecipient")}</label>
            <Select id="add-recipient" className="w-full" value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="" />
              {candidates.map((k) => (
                <option key={k.fp} value={k.fp}>{who(k)}</option>
              ))}
            </Select>
          </div>
          <Button size="sm" variant="outline" disabled={!choice || busy} onClick={() => void change({ add: [choice] })}>
            {t("private.add")}
          </Button>
        </div>
      )}
      {error && <ErrorBox>{error}</ErrorBox>}
    </section>
  );
}

/** Encrypt a note that is plain today. Says plainly what encryption cannot undo. */
export function EncryptDialog({ id, open, onOpenChange, onDone }: { id: string; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { t } = useT();
  const toast = useToast();
  const keys = useKeys(open);
  const [extra, setExtra] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const hasKey = (keys.data?.mine.length ?? 0) > 0;
  const others = (keys.data?.keyring ?? []).filter((k) => !keys.data?.mine.some((m) => m.fp === k.fp));

  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.post<WriteResult>(`${noteApi(id)}/encrypt`, { recipients: extra });
      toast("ok", t("private.encrypted"));
      onOpenChange(false);
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("private.encryptTitle")} description={t("private.encryptBody")} closeLabel={t("close")}>
        <div className="space-y-3">
          {!hasKey && keys.data && <ErrorBox>{t("private.createNeedsKey")}</ErrorBox>}
          {others.length > 0 && (
            <fieldset className="space-y-1">
              <legend className="mb-1 text-sm font-medium">{t("private.alsoFor")}</legend>
              {others.map((k) => (
                <label key={k.fp} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={extra.includes(k.fp)} onChange={(e) => setExtra((x) => (e.target.checked ? [...x, k.fp] : x.filter((f) => f !== k.fp)))} />
                  {who(k)}
                </label>
              ))}
            </fieldset>
          )}
          {error && <ErrorBox>{error}</ErrorBox>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
            <Button disabled={busy || !hasKey} onClick={() => void run()}>
              <Lock className="size-4" aria-hidden />
              {t("private.encryptConfirm")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DecryptDialog({ id, open, onOpenChange, onDone }: { id: string; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { t } = useT();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.post<WriteResult>(`${noteApi(id)}/decrypt`);
      toast("ok", t("private.decrypted"));
      onOpenChange(false);
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("private.decryptTitle")} description={t("private.decryptBody")} closeLabel={t("close")}>
        <div className="space-y-3">
          {error && <ErrorBox>{error}</ErrorBox>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
            <Button variant="destructive" disabled={busy} onClick={() => void run()}>
              {t("private.decryptConfirm")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
