import { readFile } from "node:fs/promises";
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

export async function renderTemplate(root: string, vars: TemplateVars): Promise<string> {
  let tpl = defaultTemplates[vars.type];
  try {
    tpl = await readFile(join(root, TEMPLATE_DIR, `${vars.type}.md`), "utf8");
  } catch {
    // no custom template: use the built-in one
  }
  if (tpl === undefined) throw new Error(`no template for type "${vars.type}"`);
  return tpl.replace(/\{\{(type|title|owner)\}\}/g, (_, k: keyof TemplateVars) => vars[k]);
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
