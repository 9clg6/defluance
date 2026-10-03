import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Document, isMap, isScalar, isSeq, parseDocument } from "yaml";
import { type GhNode } from "@defluance/indexer";
import { CONFIG_PATH, ConflictError, DEFAULT_SPACE, pushToOrigin, writeAndCommit } from "@defluance/vault-core";
import { type Actor } from "../auth.js";
import { type Ctx } from "../context.js";
import { HttpError, forbidden } from "../errors.js";
import { getPublicRepos, setPublicRepos } from "../github/public.js";
import { isGlobalAdmin } from "./admin.js";
import { audit, authorOf, readSpaces } from "./shared.js";

export interface GhItemFilter {
  q?: string | undefined;
  repo?: string | undefined;
  kind?: GhNode["kind"] | undefined;
  state?: GhNode["state"] | undefined;
  limit?: number | undefined;
}

/** `owner/repo` of every repository mapped to a space the actor can read (the default repos belong to space `default`). */
async function readableRepos(ctx: Ctx, actor: Actor): Promise<string[]> {
  const config = await ctx.getConfig();
  const spaces = await readSpaces(ctx, actor);
  const ok = (s: string) => !spaces || spaces.includes(s);
  return [...new Set([...(ok(DEFAULT_SPACE) ? config.repos : []), ...config.spaces.filter((s) => ok(s.name)).flatMap((s) => s.repos)])];
}

/** Issues and pull requests of the repositories the actor can see, newest first. */
export async function listGithubItems(ctx: Ctx, actor: Actor, f: GhItemFilter = {}): Promise<{ items: GhNode[] }> {
  let repos = await readableRepos(ctx, actor);
  if (f.repo) repos = repos.filter((r) => r.toLowerCase() === f.repo?.toLowerCase());
  return { items: await ctx.store.listGhNodes({ repos, kind: f.kind, state: f.state, q: f.q, limit: f.limit }) };
}

// One writer at a time for the read-modify-write of the config file (git queues the commit, not the read).
let configQueue: Promise<unknown> = Promise.resolve();

/** Add or remove `repo` in the repos of a space (or the top-level `repos`), keeping comments and layout of the file. */
function editRepos(raw: string, repo: string, space: string | undefined, linked: boolean): string | null {
  const doc = raw.trim() ? parseDocument(raw) : new Document({});
  if (doc.errors.length) throw new HttpError(422, `.defluance/config.yaml is not valid YAML: ${doc.errors[0]?.message}`);
  if (!doc.contents) doc.contents = doc.createNode({}) as never;
  let path: (string | number)[] = ["repos"];
  if (space && space !== DEFAULT_SPACE) {
    const spaces = doc.get("spaces");
    const idx = isSeq(spaces) ? spaces.items.findIndex((s) => (isScalar(s) ? s.value === space : isMap(s) && s.get("name") === space)) : -1;
    if (idx < 0) throw new HttpError(422, `unknown space "${space}"`);
    // A space written as a bare name becomes a map so it can hold repos.
    if (isScalar((spaces as { items: unknown[] }).items[idx])) doc.setIn(["spaces", idx], doc.createNode({ name: space, path: space }));
    path = ["spaces", idx, "repos"];
  }
  const list = doc.getIn(path);
  const names = isSeq(list) ? list.items.map((i) => String(isScalar(i) ? i.value : i)) : [];
  const at = names.findIndex((n) => n.toLowerCase() === repo.toLowerCase());
  if (linked) {
    if (at >= 0) return null;
    if (isSeq(list)) doc.addIn(path, repo);
    else doc.setIn(path, doc.createNode([repo]));
  } else {
    if (at < 0) return null;
    doc.deleteIn([...path, at]);
  }
  return doc.toString({ flowCollectionPadding: false, lineWidth: 0 });
}

/**
 * Link a repository to a space (or to the vault's default repos), or unlink it. Admin only. Linking needs the App to see
 * the repository, or `public: true` for a public repository read through GitHub's unauthenticated API (an installed
 * repository always goes through the App, whatever the flag says).
 */
export async function setGithubRepo(ctx: Ctx, actor: Actor, input: { repo: string; space?: string | undefined; linked: boolean; public?: boolean | undefined }) {
  if (actor.agent) throw forbidden("agents cannot link repositories");
  if (!isGlobalAdmin(actor)) throw forbidden("requires admin on every space");
  const github = ctx.github;
  if (!github) throw new HttpError(503, "GitHub is not configured");
  const wantPublic = input.linked && !!input.public;
  const sees = (list: string[]) => list.find((r) => r.toLowerCase() === input.repo.toLowerCase());
  // The demo connector lists the repositories it knows as if installed; they still count as public there.
  const visible = sees(await github.repos().catch((e: unknown) => { if (wantPublic) return []; throw e; }));
  let isPublic = false;
  let found = visible;
  if (wantPublic && (!visible || github.mock)) {
    if (!github.validatePublic) throw new HttpError(422, "this GitHub connector cannot read public repositories");
    found = await github.validatePublic(input.repo);
    isPublic = true;
  }
  // Unlinking a repository the App lost access to must stay possible: only linking needs the App to see it.
  found ??= !input.linked ? input.repo : undefined;
  if (!found) throw new HttpError(422, `the GitHub App cannot see "${input.repo}"`);
  const known: string = found;
  const space = input.space && input.space !== DEFAULT_SPACE ? input.space : undefined;

  const run = async () => {
    const raw = await readFile(join(ctx.root, CONFIG_PATH), "utf8").catch(() => "");
    const next = editRepos(raw, known, space, input.linked);
    if (next === null) return { repo: known, space: space ?? DEFAULT_SPACE, linked: input.linked, public: isPublic, changed: false, commit: null };
    let commit: string;
    try {
      commit = (await writeAndCommit(ctx.root, CONFIG_PATH, next, { message: `github: ${input.linked ? "link" : "unlink"} ${known}${isPublic ? " (public)" : ""}`, author: authorOf(actor) })).commit;
    } catch (e) {
      if (e instanceof ConflictError) throw new HttpError(409, "conflict while saving the configuration");
      throw e;
    }
    return { repo: known, space: space ?? DEFAULT_SPACE, linked: input.linked, public: isPublic, changed: true, commit };
  };
  const result = await (configQueue = configQueue.then(run, run)) as Awaited<ReturnType<typeof run>>;
  const publics = await getPublicRepos(ctx);
  const wasPublic = publics.some((r) => r.toLowerCase() === known.toLowerCase());
  if (isPublic && !wasPublic) await setPublicRepos(ctx, [...publics, known]);
  if (result.changed) {
    // The config cache follows the file's modification time, so the next read already sees the change.
    const config = await ctx.getConfig();
    if (config.vaultPush) await pushToOrigin(ctx.root, "HEAD").catch((e: unknown) => ctx.log({ msg: "push failed", error: String(e) }));
    await audit(ctx, actor, input.linked ? "github.repo.link" : "github.repo.unlink", known, { space: result.space, ...(isPublic ? { public: true } : {}) }, result.commit);
    // Linked nowhere any more: no reason to keep reading it publicly.
    const left = [...config.repos, ...config.spaces.flatMap((s) => s.repos)].some((r) => r.toLowerCase() === known.toLowerCase());
    if (!input.linked && !left && wasPublic) await setPublicRepos(ctx, publics.filter((r) => r.toLowerCase() !== known.toLowerCase()));
  }
  if (input.linked && (result.changed || (isPublic && !wasPublic))) await ctx.jobs.enqueue("github.resync", { repo: known });
  return result;
}
