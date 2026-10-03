"use client";

import { Download, KeyRound, Lock, LockOpen, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { UnlockForm } from "@/components/PrivateNote";
import { Badge, Button, Card, Dialog, DialogContent, ErrorBox, Field, Input, Spinner } from "@/components/ui";
import { useKeys, useRefreshAll } from "@/hooks/use-keys";
import { api, errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import type { KeyStatus } from "@/lib/types";

/** Settings: your keys for private notes. */
export function KeysPanel() {
  const { t, lang } = useT();
  const toast = useToast();
  const keys = useKeys();
  const refresh = useRefreshAll();
  const [name, setName] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [removing, setRemoving] = useState<KeyStatus>();
  const mine = keys.data?.mine ?? [];
  const anyUnlocked = mine.some((k) => k.unlocked);
  const mismatch = again !== "" && again !== passphrase;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.post("/api/v1/keys", { label: name.trim(), passphrase });
      toast("ok", t("private.created"));
      setName("");
      setPassphrase("");
      setAgain("");
      await keys.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const lock = async (fp?: string) => {
    try {
      await api.post(fp ? `/api/v1/keys/${fp}/lock` : "/api/v1/keys/lock");
      toast("ok", t("private.lockedOk"));
      await refresh();
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };

  const backup = async (k: KeyStatus) => {
    try {
      const file = await api.get<unknown>(`/api/v1/keys/${k.fp}/backup`);
      const url = URL.createObjectURL(new Blob([`${JSON.stringify(file, null, 2)}\n`], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `defluance-key-${k.fp.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };

  const remove = async () => {
    if (!removing) return;
    try {
      await api.del(`/api/v1/keys/${removing.fp}`);
      toast("ok", t("private.deleted"));
      setRemoving(undefined);
      await keys.reload();
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted-foreground">{t("private.intro")}</p>

      <section aria-labelledby="keys-list" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="keys-list" className="font-heading text-lg font-semibold">{t("private.keys")}</h2>
          {anyUnlocked && (
            <Button variant="outline" size="sm" onClick={() => void lock()}>
              <Lock className="size-4" aria-hidden />
              {t("private.lockAll")}
            </Button>
          )}
        </div>
        {keys.loading && !keys.data && <Spinner label={t("loading")} />}
        {keys.error && <ErrorBox>{errorMessage(keys.error)}</ErrorBox>}
        {keys.data && mine.length === 0 && <p className="text-sm text-muted-foreground">{t("private.noKeys")}</p>}
        <ul className="space-y-3">
          {mine.map((k) => (
            <li key={k.fp}>
              <Card className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <KeyRound className="size-4 text-muted-foreground" aria-hidden />
                  <span className="font-medium">{k.label}</span>
                  <Badge tone={k.unlocked ? "success" : "muted"}>
                    {k.unlocked ? <LockOpen className="mr-1 size-3" aria-hidden /> : <Lock className="mr-1 size-3" aria-hidden />}
                    {k.unlocked ? t("private.stateUnlocked") : t("private.stateLocked")}
                  </Badge>
                  {k.unlocked && k.expires_at && <span className="text-xs text-muted-foreground">{t("private.locksAt", { time: new Date(k.expires_at).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" }) })}</span>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("private.fingerprint")}: <code title={k.fp}>{k.fp.match(/.{1,8}/g)?.join(" ")}</code>
                </p>
                <div className="flex flex-wrap items-start gap-2">
                  {k.unlocked ? (
                    <Button size="sm" variant="outline" onClick={() => void lock(k.fp)}>
                      <Lock className="size-4" aria-hidden />
                      {t("private.lock")}
                    </Button>
                  ) : (
                    <div className="w-full max-w-sm">
                      <UnlockForm fps={[k.fp]} />
                    </div>
                  )}
                  <Button size="sm" variant="outline" aria-label={`${t("private.backup")}: ${k.label}`} onClick={() => void backup(k)}>
                    <Download className="size-4" aria-hidden />
                    {t("private.backup")}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" aria-label={`${t("private.delete")}: ${k.label}`} onClick={() => setRemoving(k)}>
                    <Trash2 className="size-4" aria-hidden />
                    {t("private.delete")}
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <Card>
        <h2 className="mb-3 font-heading text-lg font-semibold">{t("private.newKey")}</h2>
        <form className="max-w-md space-y-3" onSubmit={(e) => void create(e)}>
          <Field label={t("private.keyName")} id="key-name">
            <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          </Field>
          <Field label={t("private.passphrase")} id="key-pass" hint={t("private.passphraseHint")}>
            <Input id="key-pass" type="password" autoComplete="new-password" minLength={10} value={passphrase} onChange={(e) => setPassphrase(e.target.value)} required />
          </Field>
          <Field label={`${t("private.passphrase")} (2)`} id="key-pass2">
            <Input id="key-pass2" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required aria-invalid={mismatch} />
          </Field>
          {error && <ErrorBox>{error}</ErrorBox>}
          <Button type="submit" disabled={busy || !name.trim() || passphrase.length < 10 || passphrase !== again}>
            <KeyRound className="size-4" aria-hidden />
            {busy ? t("private.creating") : t("private.create")}
          </Button>
        </form>
      </Card>

      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(undefined)}>
        <DialogContent title={t("private.deleteTitle")} description={t("private.deleteBody")} closeLabel={t("close")}>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRemoving(undefined)}>{t("cancel")}</Button>
            <Button variant="destructive" onClick={() => void remove()}>{t("private.deleteConfirm")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
