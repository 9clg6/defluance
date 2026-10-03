export interface DiffRow {
  kind: "context" | "add" | "del" | "change" | "hunk";
  left: { n: number; text: string } | null;
  right: { n: number; text: string } | null;
  hunk?: string;
}

/** Unified diff (one file) to side-by-side rows. A deletion followed by an addition is shown as one changed row. */
export function sideBySide(patch: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let l = 0;
  let r = 0;
  let dels: { n: number; text: string }[] = [];
  let adds: { n: number; text: string }[] = [];
  const flush = () => {
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i++) {
      const d = dels[i] ?? null;
      const a = adds[i] ?? null;
      rows.push({ kind: d && a ? "change" : d ? "del" : "add", left: d, right: a });
    }
    dels = [];
    adds = [];
  };
  let inHunk = false;
  for (const line of patch.split("\n")) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (h) {
      flush();
      l = Number(h[1]);
      r = Number(h[2]);
      inHunk = true;
      rows.push({ kind: "hunk", left: null, right: null, hunk: line });
      continue;
    }
    if (!inHunk) continue; // file headers
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    if (line.startsWith("-")) dels.push({ n: l++, text: line.slice(1) });
    else if (line.startsWith("+")) adds.push({ n: r++, text: line.slice(1) });
    else if (line.startsWith(" ")) {
      flush();
      rows.push({ kind: "context", left: { n: l++, text: line.slice(1) }, right: { n: r++, text: line.slice(1) } });
    }
  }
  flush();
  return rows;
}
