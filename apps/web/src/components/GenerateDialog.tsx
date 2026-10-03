"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { DiffTable } from "@/components/DiffTable";
import { Button, Dialog, DialogContent, ErrorBox, Field, Spinner, Textarea } from "@/components/ui";
import { api, ApiError, errorMessage, noteApi, notePath } from "@/lib/api";
import { GENERATE_PRESETS, unifiedPatch } from "@/lib/generate";
import { useT } from "@/lib/i18n";
import type { GenerateResult } from "@/lib/types";

export type GenerateMode = "fill" | "improve";

/**
 * Ask the language model to write the note, then review what came back against the editor text. Nothing is written
 * here: Apply hands the text to the editor, and the person saves it like anything else they typed.
 * Mount it only while open, so each opening starts from `mode` and `instruction`.
 */
export function GenerateDialog({ id, current, stored, mode: initialMode = "fill", instruction: initialInstruction = "", onApply, onClose }: {
  id: string;
  /** The text in the editor now. */
  current: string;
  /** The text of the saved note. */
  stored: string;
  mode?: GenerateMode;
  instruction?: string;
  onApply: (content: string) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [mode, setMode] = useState<GenerateMode>(initialMode);
  const [instruction, setInstruction] = useState(initialInstruction);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<GenerateResult>();
  const patch = useMemo(() => (result ? unifiedPatch(current, result.content) : ""), [current, result]);

  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const body = { mode, ...(instruction.trim() ? { instruction: instruction.trim() } : {}), ...(current !== stored ? { content: current } : {}) };
      setResult(await api.post<GenerateResult>(`${noteApi(id)}/generate`, body));
    } catch (e) {
      setError(e instanceof ApiError && e.status === 503 ? t("generate.noModel") : e instanceof ApiError && e.status === 403 ? t("generate.forbidden") : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={result ? t("generate.review") : t("generate.title")} description={result ? t("generate.reviewHelp", { model: result.model }) : t("generate.help")} closeLabel={t("close")} className="max-w-4xl">
        {result ? (
          <div className="space-y-3">
            {result.warnings.length > 0 && (
              <div role="alert" className="space-y-1 rounded-lg border-2 border-warning p-3 text-sm">
                <p className="font-medium">{t("generate.warnings")}</p>
                <ul className="list-disc pl-5">
                  {result.warnings.map((w) => <li key={w}>{w}</li>)}
                </ul>
              </div>
            )}
            {patch ? <DiffTable patch={patch} label={t("generate.diff")} /> : <p className="text-sm text-muted-foreground">{t("generate.noChange")}</p>}
            {result.grounded_on.length > 0 && (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{t("generate.grounded")}</span>
                {result.grounded_on.map((g) => (
                  <Link key={g.id} href={notePath(g.id)} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">{g.title}</Link>
                ))}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setResult(undefined)}>{t("generate.back")}</Button>
              <Button variant="outline" onClick={onClose}>{t("generate.discard")}</Button>
              <Button onClick={() => onApply(result.content)}>{t("generate.apply")}</Button>
            </div>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run(); }}>
            <fieldset>
              <legend className="mb-1 text-sm font-medium">{t("generate.mode")}</legend>
              <div className="flex flex-wrap gap-4">
                {(["fill", "improve"] as const).map((m) => (
                  <label key={m} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="generate-mode" checked={mode === m} onChange={() => setMode(m)} />
                    {t(`generate.${m}`)}
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label={t("generate.instruction")} id="generate-instruction" hint={t("generate.instructionHint")}>
              <Textarea id="generate-instruction" value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={4} maxLength={2000} autoFocus />
            </Field>
            <div role="group" aria-label={t("generate.presets")} className="flex flex-wrap gap-2">
              {GENERATE_PRESETS.map((p) => (
                <Button key={p} size="sm" variant="outline" onClick={() => setInstruction((v) => (v.trim() ? `${v.trim()}\n` : "") + t(`generate.preset.${p}`))}>
                  {t(`generate.preset.${p}`)}
                </Button>
              ))}
            </div>
            {busy && <Spinner label={t("generate.busy")} />}
            {error && <ErrorBox>{error}</ErrorBox>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>{t("cancel")}</Button>
              <Button type="submit" disabled={busy}>{busy ? t("generate.busy") : t("generate.run")}</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
