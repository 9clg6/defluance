import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { LINK_TYPES, NOTE_STATUSES } from "@defluance/shared";

export interface TypeSchema {
  /** Frontmatter keys that must be present, on top of type/status/owner. */
  required: string[];
}

export interface Schema {
  types: Record<string, TypeSchema>;
  statuses: string[];
  linkTypes: string[];
}

/** Keys required on every note. Obsidian notes without them are indexed but flagged by validate. */
export const BASE_REQUIRED = ["type", "status", "owner"] as const;

export const SCHEMA_PATH = ".defluance/schema.yaml";

export const defaultSchema: Schema = {
  types: {
    "functional-spec": { required: ["acceptance_criteria"] },
    "technical-spec": { required: [] },
    adr: { required: [] },
    note: { required: [] },
    glossary: { required: [] },
    component: { required: ["paths"] },
    // Mirrors of GitHub objects, never written to the vault by hand.
    issue: { required: [] },
    "pull-request": { required: [] },
  },
  statuses: [...NOTE_STATUSES],
  linkTypes: [...LINK_TYPES],
};

function strings(v: unknown): string[] | undefined {
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : undefined;
}

/**
 * Load `.defluance/schema.yaml`. Missing file = defaults.
 * `statuses` and `link_types` replace the defaults, `types` merge over them.
 */
export async function loadSchema(root: string): Promise<Schema> {
  let raw: string;
  try {
    raw = await readFile(join(root, SCHEMA_PATH), "utf8");
  } catch {
    return structuredClone(defaultSchema);
  }
  const data = (parseYaml(raw) ?? {}) as Record<string, unknown>;
  const schema = structuredClone(defaultSchema);

  const statuses = strings(data["statuses"]);
  if (statuses?.length) schema.statuses = statuses;
  const linkTypes = strings(data["link_types"]);
  if (linkTypes?.length) schema.linkTypes = linkTypes;

  const types = data["types"];
  if (types && typeof types === "object") {
    for (const [name, def] of Object.entries(types as Record<string, unknown>)) {
      const required = strings((def as { required?: unknown } | null)?.required) ?? [];
      schema.types[name] = { required };
    }
  }
  return schema;
}

export function schemaToYaml(schema: Schema): string {
  const types = Object.entries(schema.types)
    .map(([name, t]) => `  ${name}:\n    required: [${t.required.join(", ")}]`)
    .join("\n");
  return [
    "# Defluance vault schema. See docs/vault-format.md.",
    "# Every note needs: type, status, owner (plus the keys required by its type).",
    "types:",
    types,
    `statuses: [${schema.statuses.join(", ")}]`,
    `link_types: [${schema.linkTypes.join(", ")}]`,
    "",
  ].join("\n");
}
