import { BASE_REQUIRED, type Schema } from "./schema.js";
import type { Vault } from "./vault.js";

export interface Diagnostic {
  file: string;
  line: number;
  severity: "error" | "warning";
  rule: string;
  message: string;
}

export function validateVault(vault: Vault, schema: Schema): Diagnostic[] {
  const out: Diagnostic[] = [];
  const incoming = new Set<string>();

  // First pass: resolve links so orphans can be detected.
  const resolved = vault.notes.map((note) => ({
    note,
    links: note.links.map((link) => ({ link, res: vault.resolve(link, note.id) })),
  }));
  for (const { note, links } of resolved) {
    for (const { res } of links) {
      if (res.status === "resolved" && res.note.id !== note.id) incoming.add(res.note.id);
    }
  }

  for (const { note, links } of resolved) {
    const add = (severity: Diagnostic["severity"], rule: string, message: string, line = 1) =>
      out.push({ file: note.path, line, severity, rule, message });
    const fm = note.frontmatter;

    if (note.frontmatterError) add("error", "frontmatter-invalid", note.frontmatterError);

    for (const key of BASE_REQUIRED) {
      if (fm[key] === undefined || fm[key] === null || fm[key] === "") {
        add("error", "missing-field", `missing required field "${key}"`);
      }
    }

    const type = fm["type"];
    if (typeof type === "string") {
      const def = schema.types[type];
      if (!def) {
        add("error", "unknown-type", `unknown note type "${type}" (known: ${Object.keys(schema.types).join(", ")})`);
      } else {
        for (const key of def.required) {
          if (fm[key] === undefined) add("error", "missing-field", `type "${type}" requires field "${key}"`);
        }
      }
    }

    const status = fm["status"];
    if (typeof status === "string" && !schema.statuses.includes(status)) {
      add("error", "invalid-status", `invalid status "${status}" (allowed: ${schema.statuses.join(", ")})`);
    }

    const tags = fm["tags"];
    if (tags !== undefined && !(Array.isArray(tags) && tags.every((t) => typeof t === "string"))) {
      add("error", "invalid-tags", `"tags" must be a list of strings`);
    }

    for (const { link, res } of links) {
      if (link.unknownType) {
        // Obsidian aliases look the same as a mistyped link type, so bodies only warn.
        add(
          link.strict ? "error" : "warning",
          "unknown-link-type",
          `"${link.unknownType}" is not a link type (known: ${schema.linkTypes.join(", ")})` +
            (link.strict ? "" : ", treated as a display alias"),
          link.line,
        );
      }
      if (link.kind === "github") continue;
      if (res.status === "missing") {
        add("error", "broken-link", `link target "${link.target}" not found`, link.line);
      } else {
        if (!res.headingFound) {
          add("warning", "broken-heading", `heading "${link.heading}" not found in "${res.note.id}"`, link.line);
        }
        if (res.ambiguous > 1) {
          add("warning", "ambiguous-link", `"${link.target}" matches ${res.ambiguous} notes, using "${res.note.id}"`, link.line);
        }
      }
    }

    const linksOut = links.some(({ res, link }) => link.kind === "github" || res.status === "resolved");
    if (!linksOut && !incoming.has(note.id)) add("warning", "orphan", "note has no links in or out");
  }

  return out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}
