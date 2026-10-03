import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const TEMPLATE_DIR = ".defluance/templates";

const frontmatter = (extra = "") =>
  `---\ntype: {{type}}\nstatus: draft\nowner: {{owner}}\ntags: []\n${extra}---\n\n# {{title}}\n\n`;

/** Built-in templates for the notes people write by hand. `issue` and `pull-request` are GitHub mirrors. */
export const defaultTemplates: Record<string, string> = {
  "functional-spec":
    frontmatter("acceptance_criteria: []\n") +
    "## Context\n\n## Requirements\n\n## Acceptance criteria\n\n- [ ] \n",
  "technical-spec": frontmatter() + "## Context\n\n## Design\n\n## Trade-offs\n",
  adr: frontmatter() + "## Context\n\n## Decision\n\n## Consequences\n",
  note: frontmatter() + "\n",
  glossary: frontmatter() + "## Definition\n",
  component: frontmatter("paths: []\n") + "## Responsibility\n\n## Interfaces\n",
};

export interface TemplateVars {
  type: string;
  title: string;
  owner: string;
}

/** A template name is also a file name and a note type: lowercase words joined by dashes. */
export const TEMPLATE_NAME = /^[a-z][a-z0-9-]{0,40}$/;

/**
 * `<!-- ai: guidance -->` comments are instructions for the language model that writes a note from the template.
 * A note made by hand must not carry them: the comment is removed, together with the line it sits on.
 */
export function stripAiHints(tpl: string): string {
  return tpl.replace(/^.*<!--\s*ai:[\s\S]*?-->.*(?:\r?\n|$)/gm, "");
}

/** Fill a template's `{{type}}`, `{{title}}` and `{{owner}}`. Hints are removed unless `hints` is set. */
export function renderTemplateString(tpl: string, vars: TemplateVars, opts: { hints?: boolean } = {}): string {
  return (opts.hints ? tpl : stripAiHints(tpl)).replace(/\{\{(type|title|owner)\}\}/g, (_, k: keyof TemplateVars) => vars[k]);
}

/** The template as written: the vault file when there is one, else the built-in. Undefined when neither exists. */
export async function readTemplate(root: string, name: string): Promise<string | undefined> {
  if (/[/\\\0]|\.\./.test(name)) return defaultTemplates[name]; // a type is never a path
  try {
    return await readFile(join(root, TEMPLATE_DIR, `${name}.md`), "utf8");
  } catch {
    return defaultTemplates[name]; // no custom template: use the built-in one
  }
}

export async function renderTemplate(root: string, vars: TemplateVars, opts: { hints?: boolean } = {}): Promise<string> {
  const tpl = await readTemplate(root, vars.type);
  if (tpl === undefined) throw new Error(`no template for type "${vars.type}"`);
  return renderTemplateString(tpl, vars, opts);
}

export interface TemplateInfo {
  name: string;
  /** `builtin`: shipped, `vault`: a file with a new name, `override`: a file replacing a built-in. */
  source: "builtin" | "vault" | "override";
  content: string;
}

/** Built-in templates and the files of `.defluance/templates`, by name. */
export async function listTemplates(root: string): Promise<TemplateInfo[]> {
  const files = (await readdir(join(root, TEMPLATE_DIR)).catch(() => [] as string[])).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).filter((n) => TEMPLATE_NAME.test(n));
  const names = [...new Set([...Object.keys(defaultTemplates), ...files])].sort();
  return Promise.all(
    names.map(async (name) => {
      const inVault = files.includes(name);
      const content = (inVault ? await readFile(join(root, TEMPLATE_DIR, `${name}.md`), "utf8") : undefined) ?? defaultTemplates[name] ?? "";
      return { name, source: inVault ? (name in defaultTemplates ? "override" : "vault") : "builtin", content } as TemplateInfo;
    }),
  );
}

/** "Spec d'authentification" -> "spec-d-authentification" */
export function slugify(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
