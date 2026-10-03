"use client";

import { sideBySide } from "@/lib/diff";
import { cn } from "@/lib/utils";

/** A unified diff of one file as a side-by-side table: old lines left, new lines right. */
export function DiffTable({ patch, label }: { patch: string; label: string }) {
  const rows = sideBySide(patch);
  const cell = (c: { n: number; text: string } | null, tone: string) => (
    <>
      <td className="w-10 select-none px-2 text-right text-xs text-muted-foreground">{c?.n ?? ""}</td>
      <td className={cn("whitespace-pre-wrap break-words px-2 font-mono text-xs", tone)}>{c?.text ?? ""}</td>
    </>
  );
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full table-fixed border-collapse" aria-label={label}>
        <caption className="sr-only">{label}</caption>
        <colgroup>
          <col className="w-10" />
          <col />
          <col className="w-10" />
          <col />
        </colgroup>
        <tbody>
          {rows.map((r, i) =>
            r.kind === "hunk" ? (
              <tr key={i} className="bg-muted">
                <td colSpan={4} className="px-2 py-1 font-mono text-xs text-muted-foreground">{r.hunk}</td>
              </tr>
            ) : (
              <tr key={i} className="align-top">
                {cell(r.left, r.kind === "del" || r.kind === "change" ? "border-l-4 border-destructive bg-destructive/20" : "")}
                {cell(r.right, r.kind === "add" || r.kind === "change" ? "border-l-4 border-success bg-success/20" : "")}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
