import type * as Y from "yjs";

/** One-click instructions in the generate dialog. The label of each (`generate.preset.<id>`) is also the instruction sent. */
export const GENERATE_PRESETS = ["testable", "edge", "shorten", "french"] as const;

/** A note id in the vault templates: what the server accepts for a template name. */
export const TEMPLATE_NAME = /^[a-z][a-z0-9-]{0,40}$/;

/** Put `next` in a shared text in one transaction: collaborators get a single change, and one undo step. */
export function replaceYText(text: Y.Text, next: string): void {
  text.doc?.transact(() => {
    text.delete(0, text.length);
    text.insert(0, next);
  });
}

type Op = { t: " " | "-" | "+"; text: string; o: number; n: number };

/**
 * Unified diff (one file, 3 lines of context) between two texts, for DiffTable. Lines are compared whole, with a plain
 * LCS table after trimming the shared head and tail: fine for notes, quadratic in the changed middle for huge rewrites.
 */
export function unifiedPatch(a: string, b: string, context = 3): string {
  const x = a.split("\n");
  const y = b.split("\n");
  let head = 0;
  while (head < x.length && head < y.length && x[head] === y[head]) head++;
  let tail = 0;
  while (tail < x.length - head && tail < y.length - head && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++;
  const mx = x.slice(head, x.length - tail);
  const my = y.slice(head, y.length - tail);
  const L = Array.from({ length: mx.length + 1 }, () => new Uint32Array(my.length + 1));
  for (let i = mx.length - 1; i >= 0; i--) for (let j = my.length - 1; j >= 0; j--) L[i]![j] = mx[i] === my[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);

  const ops: Op[] = [];
  let o = 1;
  let n = 1;
  const push = (t: Op["t"], text: string) => {
    ops.push({ t, text, o, n });
    if (t !== "+") o++;
    if (t !== "-") n++;
  };
  for (let i = 0; i < head; i++) push(" ", x[i]!);
  let i = 0;
  let j = 0;
  while (i < mx.length || j < my.length) {
    if (i < mx.length && j < my.length && mx[i] === my[j]) {
      push(" ", mx[i++]!);
      j++;
    }
    else if (j < my.length && (i === mx.length || L[i]![j + 1]! >= L[i + 1]![j]!)) push("+", my[j++]!);
    else push("-", mx[i++]!);
  }
  for (let k = x.length - tail; k < x.length; k++) push(" ", x[k]!);

  const keep = ops.map(() => false);
  ops.forEach((op, k) => {
    if (op.t === " ") return;
    for (let m = Math.max(0, k - context); m <= Math.min(ops.length - 1, k + context); m++) keep[m] = true;
  });
  const out: string[] = [];
  for (let k = 0; k < ops.length; ) {
    if (!keep[k]) {
      k++;
      continue;
    }
    let end = k;
    while (end < ops.length && keep[end]) end++;
    const hunk = ops.slice(k, end);
    const oc = hunk.filter((p) => p.t !== "+").length;
    const nc = hunk.filter((p) => p.t !== "-").length;
    out.push(`@@ -${hunk[0]!.o},${oc} +${hunk[0]!.n},${nc} @@`, ...hunk.map((p) => `${p.t}${p.text}`));
    k = end;
  }
  return out.join("\n");
}
