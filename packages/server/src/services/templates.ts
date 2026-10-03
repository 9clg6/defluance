import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { ConflictError, TEMPLATE_DIR, TEMPLATE_NAME, applyAndCommit, head, listTemplates as listVaultTemplates, parseNote, pushToOrigin, renderTemplateString } from "@defluance/vault-core";
import { type Actor } from "../auth.js";
import { type Ctx } from "../context.js";
import { HttpError, forbidden } from "../errors.js";
import { isGlobalAdmin } from "./admin.js";
import { audit, authorOf } from "./shared.js";

export const MAX_TEMPLATE = 20 * 1024;

/** Every template the vault can use: the built-in ones, vault files, and vault files that replace a built-in. */
export async function listTemplates(ctx: Ctx) {
  return { items: await listVaultTemplates(ctx.root) };
}

function checkWriter(actor: Actor) {
  if (actor.agent) throw forbidden("agents cannot change templates");
  if (!isGlobalAdmin(actor)) throw forbidden("requires admin on every space");
}

function checkName(name: string) {
  if (!TEMPLATE_NAME.test(name)) throw new HttpError(422, "a template name is lowercase letters, digits and dashes, starting with a letter (40 characters at most)");
}

/** Create or replace a template file in the vault, in one commit. */
export async function putTemplate(ctx: Ctx, actor: Actor, name: string, content: string) {
  checkWriter(actor);
  checkName(name);
  if (Buffer.byteLength(content) > MAX_TEMPLATE) throw new HttpError(413, `a template is limited to ${MAX_TEMPLATE / 1024} KB`);
  // A template must produce a note that reads: render it with sample values, as "new note" would.
  const sample = parseNote(`${name}.md`, renderTemplateString(content, { type: name, title: "Sample", owner: "sample" }), { linkTypes: (await ctx.getSchema()).linkTypes });
  if (sample.frontmatterError) throw new HttpError(422, `the template does not produce a valid note: ${sample.frontmatterError}`);
  const missing = ["type", "status", "owner"].filter((k) => !sample.frontmatter[k]);
  if (missing.length) throw new HttpError(422, `the template does not produce a valid note: frontmatter must set ${missing.join(", ")}`);

  const path = `${TEMPLATE_DIR}/${name}.md`;
  const same = (await readFile(join(ctx.root, path), "utf8").catch(() => null)) === content;
  let commit: string;
  try {
    commit = same ? await head(ctx.root) : (await applyAndCommit(ctx.root, { writes: [{ path, content }] }, { message: `template: ${name}`, author: authorOf(actor) })).commit;
  } catch (e) {
    if (e instanceof ConflictError) throw new HttpError(409, "conflict while saving the template");
    throw e;
  }
  if (!same && (await ctx.getConfig()).vaultPush) await pushToOrigin(ctx.root, "HEAD").catch((e: unknown) => ctx.log({ msg: "push failed", error: String(e) }));
  await audit(ctx, actor, "template.put", name, { bytes: Buffer.byteLength(content) }, commit);
  return { name, commit };
}

/** Remove a template file. A built-in template that was overridden is back. */
export async function deleteTemplate(ctx: Ctx, actor: Actor, name: string) {
  checkWriter(actor);
  checkName(name);
  const path = `${TEMPLATE_DIR}/${name}.md`;
  if (!(await stat(join(ctx.root, path)).then((s) => s.isFile(), () => false))) throw new HttpError(404, `no vault template "${name}" to delete`);
  const { commit } = await applyAndCommit(ctx.root, { removes: [path] }, { message: `template: ${name}`, author: authorOf(actor) });
  if ((await ctx.getConfig()).vaultPush) await pushToOrigin(ctx.root, "HEAD").catch((e: unknown) => ctx.log({ msg: "push failed", error: String(e) }));
  await audit(ctx, actor, "template.delete", name, {}, commit);
  return { name, commit };
}
