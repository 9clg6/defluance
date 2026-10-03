#!/usr/bin/env node
// Copy components from the Arc UI registry (https://uiarc.dev, MIT) into src/components/arc.
//
//   node scripts/arc-import.mjs button tabs dialog
//
// Arc's design tokens are generic names (--background, --accent, --border) that would collide with ours, so every
// token reference in the copied files is prefixed --arc-, and src/components/arc/arc-theme.css maps those onto
// Defluance's own palette. The source is ours once copied: this script only exists to make the copy repeatable.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "components", "arc");
const names = process.argv.slice(2);
if (!names.length) {
  console.error("usage: arc-import.mjs <component>...");
  process.exit(2);
}

const registry = (n) => `https://uiarc.dev/r/${n}.json`;
const seen = new Map();

async function load(name) {
  if (seen.has(name)) return;
  const res = await fetch(registry(name));
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  const item = await res.json();
  seen.set(name, item);
  for (const dep of item.registryDependencies ?? []) await load(dep.replace(/^https:\/\/uiarc\.dev\/r\//, "").replace(/\.json$/, ""));
}
for (const n of names) await load(n);

// every token the foundation defines, to prefix exactly those and leave component-local custom properties alone
const foundation = seen.get("arc-foundation")?.files?.find((f) => f.path.endsWith("foundation.css"))?.content ?? "";
const tokens = new Set([...foundation.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]).filter((n) => !n.startsWith("--arc-"))); // --arc-gradient* already carry the prefix
if (tokens.size < 40) throw new Error("could not read the Arc foundation tokens");
const prefix = (text) => text.replace(/var\((--[a-z0-9-]+)/g, (m, name) => (tokens.has(name) ? `var(--arc-${name.slice(2)}` : m));

// Vendored: written against looser compiler settings than ours (noUncheckedIndexedAccess), so it is not type-checked here.
const banner = (name) => `// @ts-nocheck\n// Source: Arc UI "${name}" (https://uiarc.dev, MIT). Copied with scripts/arc-import.mjs; design tokens are prefixed --arc- and mapped in arc-theme.css.\n`;

// Small, deliberate changes to the copied files. Each must match exactly once, or the import stops: an upstream change
// to a patched line is something to look at, not to overwrite.
const patches = [
  // the close button's label comes from the caller, so it can be translated
  ["dialog/dialog.tsx", "export function DialogContent({ title, description, children, className, onPointerDownOutside, ...props }: DialogContentProps) {", "export function DialogContent({ title, description, children, className, closeLabel, onPointerDownOutside, ...props }: DialogContentProps & { closeLabel?: string }) {"],
  ["dialog/dialog.tsx", 'aria-label="Close dialog"', 'aria-label={closeLabel ?? "Close dialog"}'],
  // a primary button is our blue, not Arc's black-on-white
  ["button/button.module.css", ".primary { color: var(--arc-background); background: var(--arc-foreground); border-color: var(--arc-foreground); }", ".primary { color: var(--arc-accent-foreground); background: var(--arc-accent); border-color: var(--arc-accent); }"],
  // Status badges are solid, saturated colour with readable text (not the 10% tints Arc ships with): no pastels.
  ["badge/badge.module.css", ".success { --badge-color: var(--arc-success); --badge-foreground: var(--arc-success); --badge-background: color-mix(in oklab, var(--arc-success) 10%, var(--arc-surface)); --badge-border: color-mix(in oklab, var(--arc-success) 25%, var(--arc-border)); }", ".success { --badge-color: var(--arc-success); --badge-foreground: var(--success-foreground); --badge-background: var(--arc-success); --badge-border: var(--arc-success); }"],
  ["badge/badge.module.css", ".info { --badge-color: var(--arc-accent); --badge-foreground: var(--arc-accent-strong); --badge-background: var(--arc-accent-subtle); --badge-border: color-mix(in oklab, var(--arc-accent) 24%, var(--arc-border)); }", ".info { --badge-color: var(--arc-accent); --badge-foreground: var(--arc-accent-foreground); --badge-background: var(--arc-accent); --badge-border: var(--arc-accent); }"],
  ["badge/badge.module.css", ".warning { --badge-color: var(--arc-warning); --badge-foreground: var(--arc-warning); --badge-background: color-mix(in oklab, var(--arc-warning) 11%, var(--arc-surface)); --badge-border: color-mix(in oklab, var(--arc-warning) 27%, var(--arc-border)); }", ".warning { --badge-color: var(--warning-solid); --badge-foreground: oklch(0.2 0 0); --badge-background: var(--warning-solid); --badge-border: var(--warning-solid); }"],
  ["badge/badge.module.css", ".danger { --badge-color: var(--arc-danger); --badge-foreground: var(--arc-danger); --badge-background: color-mix(in oklab, var(--arc-danger) 10%, var(--arc-surface)); --badge-border: color-mix(in oklab, var(--arc-danger) 26%, var(--arc-border)); }", ".danger { --badge-color: var(--arc-danger); --badge-foreground: var(--destructive-foreground); --badge-background: var(--arc-danger); --badge-border: var(--arc-danger); }"],
  ["badge/badge.module.css", "  .badge:hover { border-color: color-mix(in oklab, var(--badge-color, var(--arc-foreground)) 32%, var(--arc-border)); background: color-mix(in oklab, var(--badge-color, var(--arc-foreground)) 10%, var(--arc-surface)); }", "  .badge:hover { opacity: .92; }"],
];
const written = new Map();

const deps = new Set();
for (const [name, item] of seen) {
  for (const d of item.dependencies ?? []) deps.add(d);
  for (const f of item.files ?? []) {
    if (f.path.endsWith("foundation.css")) continue; // replaced by arc-theme.css
    const target = (f.target ?? "").replace(/^@components\/arc\//, "");
    if (!target) continue;
    let content = f.content;
    if (target.endsWith(".css")) {
      content = prefix(content).replaceAll('[data-theme="dark"]', ":global(.dark)");
    } else if (/\.tsx?$/.test(target)) {
      content = banner(name) + prefix(content);
    }
    for (const [file, from, to] of patches) {
      if (file !== target) continue;
      if (content.split(from).length !== 2) throw new Error(`patch for ${file} no longer matches: ${from.slice(0, 60)}`);
      content = content.replace(from, to);
      written.set(file + from, true);
    }
    const out = join(root, target);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, content);
  }
}

console.log(`copied ${[...seen.keys()].filter((n) => n !== "arc-foundation").join(", ")}`);
console.log(`npm dependencies: ${[...deps].sort().join(" ")}`);
