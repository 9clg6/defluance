import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  MergeError,
  branchPatch,
  changedFiles,
  currentBranch,
  deleteBranch,
  isEncrypted,
  listBranches,
  mergeBranch,
  mergeable,
  pushToOrigin,
  readAt,
  spaceOf,
} from "@defluance/vault-core";
import { type Actor, can } from "../auth.js";
import { type Ctx, indexAfterWrite } from "../context.js";
import { HttpError, forbidden, notFound } from "../errors.js";
import { openPrivate } from "./private.js";
import { audit, authorOf } from "./shared.js";

/*
 * Drafts: what agents write. An agent never writes to the main branch: each of its saves lands on a branch named
 * `defluance/<agent>/<note>`. A person reviews the branch here and merges it, discards it, or sends it to GitHub as a
 * pull request. Agents cannot do any of this: a person decides what becomes the source of truth.
 */

const PREFIX = "defluance/";
const BRANCH = /^defluance\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export interface DraftFile {
  path: string;
  /** Note id, or null for a file that is not a note. */
  id: string | null;
  /** A: added, M: modified, D: deleted. */
  status: string;
  /** The text is encrypted: no diff is shown. */
  private: boolean;
}

export interface Draft {
  branch: string;
  /** The agent that wrote it, from the branch name. */
  agent: string;
  files: DraftFile[];
  commits: number;
  last: { date: string; author: string; message: string };
  /** Merges cleanly into the current branch. `null`: this git cannot tell. */
  mergeable: boolean | null;
}

const checkBranch = (branch: string) => {
  if (!BRANCH.test(branch)) throw new HttpError(400, "not a draft branch");
  return branch;
};

const idOf = (path: string) => (path.endsWith(".md") && !path.startsWith(".") ? path.slice(0, -3) : null);

/** A draft is hidden unless the actor may read every space it touches. */
async function describe(ctx: Ctx, actor: Actor, b: { name: string; date: string; author: string; subject: string; ahead: number }, base: string): Promise<Draft | null> {
  const config = await ctx.getConfig();
  const files: DraftFile[] = [];
  for (const f of await changedFiles(ctx.root, base, b.name)) {
    const id = idOf(f.path);
    if (id && !can(actor, "read", spaceOf(config, id))) return null;
    let priv = false;
    if (id && f.status !== "D") priv = isEncrypted(await readAt(ctx.root, f.path, b.name).catch(() => ""));
    files.push({ path: f.path, id, status: f.status, private: priv });
  }
  return {
    branch: b.name,
    agent: b.name.split("/")[1] ?? "",
    files,
    commits: b.ahead,
    last: { date: b.date, author: b.author, message: b.subject },
    mergeable: await mergeable(ctx.root, base, b.name),
  };
}

export async function listDrafts(ctx: Ctx, actor: Actor): Promise<Draft[]> {
  const base = await currentBranch(ctx.root);
  const out: Draft[] = [];
  for (const b of await listBranches(ctx.root, PREFIX, base)) {
    if (b.ahead === 0) continue; // nothing on it that main does not have
    const d = await describe(ctx, actor, b, base);
    if (d) out.push(d);
  }
  return out;
}

async function one(ctx: Ctx, actor: Actor, branch: string): Promise<{ draft: Draft; base: string }> {
  checkBranch(branch);
  const base = await currentBranch(ctx.root);
  const b = (await listBranches(ctx.root, PREFIX, base)).find((x) => x.name === branch);
  const draft = b ? await describe(ctx, actor, b, base) : null;
  if (!draft) throw notFound("draft");
  return { draft, base };
}

/** The changes of a draft, file by file. Encrypted notes show that they changed, not how. */
export async function draftDiff(ctx: Ctx, actor: Actor, branch: string) {
  const { draft, base } = await one(ctx, actor, branch);
  const files = await Promise.all(draft.files.map(async (f) => ({ ...f, patch: f.private ? "" : await branchPatch(ctx.root, base, branch, f.path) })));
  return { ...draft, files };
}

/** A draft can be acted on by a person who may write every space it touches. */
async function writable(ctx: Ctx, actor: Actor, draft: Draft) {
  if (actor.agent) throw forbidden("agents cannot approve their own drafts: a person must");
  const config = await ctx.getConfig();
  for (const f of draft.files) {
    if (!f.id) continue;
    const space = spaceOf(config, f.id);
    if (!can(actor, "write", space)) throw forbidden(`requires "write" on space "${space}"`);
  }
}

export async function mergeDraft(ctx: Ctx, actor: Actor, branch: string) {
  const { draft, base } = await one(ctx, actor, branch);
  await writable(ctx, actor, draft);
  // Merging a private note without being able to read it would be approving blind.
  for (const f of draft.files.filter((x) => x.private)) await openPrivate(ctx, actor, await readAt(ctx.root, f.path, branch));
  const message = `Merge draft ${draft.files.map((f) => f.id ?? f.path).join(", ")} by ${draft.agent}`;
  let head: string;
  try {
    head = await mergeBranch(ctx.root, branch, message, authorOf(actor));
  } catch (e) {
    if (e instanceof MergeError) {
      throw new HttpError(409, e.reason === "dirty" ? "the vault has uncommitted changes: commit or discard them first" : "the draft conflicts with changes made since it was written", { reason: e.reason });
    }
    throw e;
  }
  const paths = draft.files.map((f) => f.path);
  await indexAfterWrite(ctx, paths);
  for (const f of draft.files) {
    if (!f.id || f.private || f.status === "D") continue;
    const text = await readFile(join(ctx.root, f.path), "utf8").catch(() => null);
    if (text !== null) ctx.collab.noteWritten(f.id, head, actor.name, text);
  }
  await deleteBranch(ctx.root, branch);
  if ((await ctx.getConfig()).vaultPush) await pushToOrigin(ctx.root, "HEAD").catch((e: unknown) => ctx.log({ msg: "push failed", error: String(e) }));
  await audit(ctx, actor, "draft.merge", draft.files[0]?.id ?? null, { branch, files: draft.files.map((f) => f.path) }, head);
  return { merged: true, commit: head, files: paths };
}

export async function discardDraft(ctx: Ctx, actor: Actor, branch: string) {
  const { draft } = await one(ctx, actor, branch);
  await writable(ctx, actor, draft);
  await deleteBranch(ctx.root, branch);
  await audit(ctx, actor, "draft.discard", draft.files[0]?.id ?? null, { branch, files: draft.files.map((f) => f.path) });
  return { discarded: true };
}

/** Push the branch and open a pull request in the vault's repository (`vault_repo` in the vault config). */
export async function draftPullRequest(ctx: Ctx, actor: Actor, branch: string) {
  const { draft, base } = await one(ctx, actor, branch);
  await writable(ctx, actor, draft);
  const config = await ctx.getConfig();
  if (!ctx.github) throw new HttpError(503, "GitHub is not configured");
  if (!config.vaultRepo) throw new HttpError(422, "set `vault_repo` in .defluance/config.yaml to open pull requests for drafts");
  if (!(await pushToOrigin(ctx.root, branch).catch((e: unknown) => { throw new HttpError(502, `could not push the branch: ${e instanceof Error ? e.message : String(e)}`); }))) {
    throw new HttpError(422, "the vault has no remote named origin to push to");
  }
  const names = draft.files.map((f) => f.id ?? f.path);
  const list = draft.files.map((f) => `- \`${f.path}\`${f.private ? " (private: not shown)" : ""}`).join("\n");
  const pr = await ctx.github.createPullRequest(config.vaultRepo, {
    title: `Draft by ${draft.agent}: ${names.join(", ")}`,
    body: `Written by the agent **${draft.agent}**, for review.\n\n${list}\n\n_Opened from Defluance by ${actor.name}._`,
    head: branch,
    base,
  });
  await audit(ctx, actor, "draft.pull-request", draft.files[0]?.id ?? null, { branch, url: pr.url });
  return pr;
}
