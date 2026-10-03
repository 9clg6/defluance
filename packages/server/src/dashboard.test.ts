import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = fileURLToPath(new URL(".", import.meta.url));
const dashboard = JSON.parse(readFileSync(join(here, "../../../deploy/grafana/defluance.json"), "utf8")) as { panels: { title: string; targets: { expr: string }[] }[] };

describe("Grafana dashboard", () => {
  const source = readdirSync(here, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => readFileSync(join(here, f), "utf8"))
    .join("\n");
  const emitted = new Set([...source.matchAll(/\b(defluance_[a-z_]+)\b/g)].map((m) => m[1] as string));

  it("only charts metrics the server really exposes", () => {
    const used = new Set(dashboard.panels.flatMap((p) => p.targets.flatMap((t) => [...t.expr.matchAll(/defluance_[a-z_]+/g)].map((m) => m[0].replace(/_(sum|count)$/, "")))));
    expect(used.size).toBeGreaterThan(8);
    for (const name of used) expect(emitted, `metric ${name} is charted but never emitted`).toContain(name);
  });

  it("has a title and a query on every panel", () => {
    for (const p of dashboard.panels) {
      expect(p.title).toBeTruthy();
      expect(p.targets.every((t) => t.expr.length > 0)).toBe(true);
    }
  });
});
