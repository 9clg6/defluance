import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { simpleGit, type SimpleGit } from "simple-git";

export class ConflictError extends Error {
  constructor(
    readonly path: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`${path} changed since ${expected.slice(0, 7)} (now ${actual.slice(0, 7)})`);
    this.name = "ConflictError";
  }
}

export interface Author {
  name: string;
  email: string;
}

export interface WriteOptions {
  message: string;
  author: Author;
  /** Last commit the caller saw for this file. Mismatch throws ConflictError. */
  baseCommit?: string;
  /** Commit on this branch (created from HEAD if absent) without touching the working tree. */
  branch?: string;
}

export interface CommitInfo {
  hash: string;
  date: string;
  message: string;
  author: string;
}

const git = (repo: string, author?: Author): SimpleGit =>
  simpleGit({
    baseDir: repo,
    config: author ? [`user.name=${author.name}`, `user.email=${author.email}`] : [],
  });

/** Reject absolute paths and `..` escapes: file paths come from API callers. */
function safePath(repo: string, path: string): string {
  const abs = resolve(repo, path);
  const rel = relative(resolve(repo), abs);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`path escapes the vault: ${path}`);
  return rel.split("\\").join("/");
}

export async function initRepo(repo: string): Promise<void> {
  await mkdir(repo, { recursive: true });
  await git(repo).init(["-b", "main"]);
}

export async function head(repo: string): Promise<string> {
  return (await git(repo).revparse(["HEAD"])).trim();
}

export async function readAt(repo: string, path: string, rev = "HEAD"): Promise<string> {
  return git(repo).show([`${rev}:${safePath(repo, path)}`]);
}

/** Last commit that touched the file, or null if it was never committed. */
export async function lastCommitFor(repo: string, path: string, rev = "HEAD"): Promise<string | null> {
  try {
    const out = await git(repo).raw(["log", "-1", "--format=%H", rev, "--", safePath(repo, path)]);
    return out.trim() || null;
  } catch {
    return null; // no commits yet, or unknown rev
  }
}

export async function fileLog(repo: string, path: string): Promise<CommitInfo[]> {
  const log = await git(repo).log({ file: safePath(repo, path) });
  return log.all.map((c) => ({ hash: c.hash, date: c.date, message: c.message, author: c.author_name }));
}

export async function diff(repo: string, from: string, to: string, path?: string): Promise<string> {
  return git(repo).diff([from, to, ...(path ? ["--", safePath(repo, path)] : [])]);
}

export async function createBranch(repo: string, name: string, from = "HEAD"): Promise<void> {
  await git(repo).branch([name, from]);
}

/** Git allows one writer per repository (index.lock): queue writers per path instead of letting all but one fail. */
const queues = new Map<string, Promise<unknown>>();
function serialized<T>(repo: string, fn: () => Promise<T>): Promise<T> {
  repo = resolve(repo);
  const run = (queues.get(repo) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => undefined);
  queues.set(repo, tail);
  void tail.then(() => queues.get(repo) === tail && queues.delete(repo));
  return run;
}

export function writeAndCommit(repo: string, path: string, content: string, opts: WriteOptions): Promise<{ commit: string; branch?: string }> {
  return serialized(repo, () => writeAndCommitNow(repo, path, content, opts));
}

async function writeAndCommitNow(
  repo: string,
  path: string,
  content: string,
  opts: WriteOptions,
): Promise<{ commit: string; branch?: string }> {
  const rel = safePath(repo, path);

  if (opts.baseCommit) {
    const current = await lastCommitFor(repo, rel, opts.branch ?? "HEAD");
    if (current && current !== opts.baseCommit) throw new ConflictError(rel, opts.baseCommit, current);
  }

  if (opts.branch) {
    const exists = (await git(repo).branchLocal()).all.includes(opts.branch);
    const tmp = await mkdtemp(join(tmpdir(), "defluance-wt-"));
    try {
      await git(repo).raw(
        exists ? ["worktree", "add", tmp, opts.branch] : ["worktree", "add", "-b", opts.branch, tmp, "HEAD"],
      );
      const { commit } = await writeAndCommitNow(tmp, rel, content, { message: opts.message, author: opts.author });
      return { commit, branch: opts.branch };
    } finally {
      await git(repo).raw(["worktree", "remove", "--force", tmp]).catch(() => undefined);
      await rm(tmp, { recursive: true, force: true });
    }
  }

  const abs = join(repo, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
  const g = git(repo, opts.author);
  await g.add(rel);
  await g.commit(opts.message, [rel], { "--author": `${opts.author.name} <${opts.author.email}>` });
  return { commit: await head(repo) };
}

/** Fast-forward the current branch from `origin`. */
export async function pull(repo: string): Promise<void> {
  await git(repo).pull(["--ff-only"]);
}

/** Push HEAD (or a branch) to `origin`. No-op without a remote. */
export async function pushToOrigin(repo: string, ref = "HEAD"): Promise<boolean> {
  const g = git(repo);
  if (!(await g.getRemotes()).some((r) => r.name === "origin")) return false;
  await g.push(["origin", ref]);
  return true;
}

// ---------------------------------------------------------------- branches (drafts written by agents)

export interface BranchInfo {
  name: string;
  /** Commit date of the tip, ISO 8601. */
  date: string;
  author: string;
  /** Subject of the tip commit. */
  subject: string;
  /** Commits on the branch that are not on `base`. */
  ahead: number;
}

export async function currentBranch(repo: string): Promise<string> {
  return (await git(repo).raw(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
}

/** Local branches under a prefix, newest first. */
export async function listBranches(repo: string, prefix: string, base: string): Promise<BranchInfo[]> {
  const g = git(repo);
  const out = await g.raw(["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)%09%(committerdate:iso-strict)%09%(authorname)%09%(subject)", `refs/heads/${prefix}`]);
  const rows = out.split("\n").filter(Boolean).map((l) => l.split("\t"));
  return Promise.all(
    rows.map(async ([name = "", date = "", author = "", subject = ""]) => ({
      name,
      date,
      author,
      subject,
      ahead: Number((await g.raw(["rev-list", "--count", `${base}..${name}`])).trim()) || 0,
    })),
  );
}

/** Files a branch changed since it left `base`, with git's status letter (A, M, D). */
export async function changedFiles(repo: string, base: string, branch: string): Promise<{ status: string; path: string }[]> {
  const out = await git(repo).raw(["diff", "--name-status", "--no-renames", `${base}...${branch}`]);
  return out.split("\n").filter(Boolean).map((l) => {
    const [status = "", ...rest] = l.split("\t");
    return { status: status.charAt(0), path: rest.join("\t") };
  });
}

/** What the branch changes in one file, as a unified diff against the point where it left `base`. */
export async function branchPatch(repo: string, base: string, branch: string, path: string): Promise<string> {
  return git(repo).raw(["diff", `${base}...${branch}`, "--", safePath(repo, path)]);
}

/**
 * Whether the branch merges into `base` without conflicts, decided without touching the working tree.
 * `null` when this git is too old to say (`merge-tree --write-tree` needs 2.38).
 */
export async function mergeable(repo: string, base: string, branch: string): Promise<boolean | null> {
  try {
    // Clean: the output is one line, the tree. A conflict adds the names of the conflicting files. (Messages are
    // translated and the exit code is not always an error to simple-git, so neither is used.)
    const out = await git(repo).raw(["merge-tree", "--write-tree", "--name-only", "--no-messages", base, branch]);
    return out.split("\n").filter(Boolean).length === 1;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return /unknown option|usage:/i.test(msg) ? null : false;
  }
}

export class MergeError extends Error {
  constructor(
    readonly reason: "conflict" | "dirty",
    message: string,
  ) {
    super(message);
    this.name = "MergeError";
  }
}

/** Merge a branch into the checked-out branch with a merge commit, and return the new HEAD. Nothing is left half done on failure. */
export function mergeBranch(repo: string, branch: string, message: string, author: Author): Promise<string> {
  return serialized(repo, async () => {
    const g = git(repo, author);
    try {
      await g.raw(["merge", "--no-ff", "-m", message, branch]);
      // A conflict leaves the merge half done with an exit code simple-git may not report as an error.
      const pending = await g.raw(["rev-parse", "-q", "--verify", "MERGE_HEAD"]).then((o) => o.trim(), () => "");
      if (pending) throw new MergeError("conflict", "merge conflict");
    } catch (e) {
      if (e instanceof MergeError) {
        await g.raw(["merge", "--abort"]).catch(() => undefined);
        throw e;
      }
      await g.raw(["merge", "--abort"]).catch(() => undefined);
      const msg = e instanceof Error ? e.message : String(e);
      throw new MergeError(/local changes|untracked working tree/i.test(msg) ? "dirty" : "conflict", msg);
    }
    return (await g.revparse(["HEAD"])).trim();
  });
}

export function deleteBranch(repo: string, branch: string): Promise<void> {
  return serialized(repo, async () => {
    await git(repo).raw(["branch", "-D", branch]);
  });
}
