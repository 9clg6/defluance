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

export async function writeAndCommit(
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
      const { commit } = await writeAndCommit(tmp, rel, content, { message: opts.message, author: opts.author });
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
