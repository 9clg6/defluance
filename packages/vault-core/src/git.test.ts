import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConflictError, diff, fileLog, head, initRepo, lastCommitFor, readAt, writeAndCommit } from "./git.js";

const author = { name: "Ana", email: "ana@example.com" };
let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "dfl-test-"));
  await initRepo(repo);
});
afterEach(() => rm(repo, { recursive: true, force: true }));

describe("git operations", () => {
  it("writes, commits and reads back at a revision", async () => {
    const { commit } = await writeAndCommit(repo, "specs/a.md", "v1", { message: "add a", author });
    await writeAndCommit(repo, "specs/a.md", "v2", { message: "edit a", author });
    expect(await readAt(repo, "specs/a.md")).toBe("v2");
    expect(await readAt(repo, "specs/a.md", commit)).toBe("v1");
    expect(await lastCommitFor(repo, "specs/a.md")).toBe(await head(repo));
  });

  it("records the author", async () => {
    await writeAndCommit(repo, "a.md", "x", { message: "m", author });
    expect((await fileLog(repo, "a.md"))[0]).toMatchObject({ author: "Ana", message: "m" });
  });

  it("detects a conflict from a stale base commit, and accepts the right one", async () => {
    const first = await writeAndCommit(repo, "a.md", "v1", { message: "1", author });
    await writeAndCommit(repo, "a.md", "v2", { message: "2", author });
    await expect(
      writeAndCommit(repo, "a.md", "mine", { message: "3", author, baseCommit: first.commit }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await readAt(repo, "a.md")).toBe("v2");
    const now = (await lastCommitFor(repo, "a.md")) as string;
    await writeAndCommit(repo, "a.md", "mine", { message: "3", author, baseCommit: now });
    expect(await readAt(repo, "a.md")).toBe("mine");
  });

  it("commits on a branch without touching HEAD or the working tree", async () => {
    await writeAndCommit(repo, "a.md", "v1", { message: "1", author });
    const before = await head(repo);
    const r = await writeAndCommit(repo, "draft.md", "new", { message: "draft", author, branch: "agent/draft" });
    expect(r.branch).toBe("agent/draft");
    expect(await head(repo)).toBe(before);
    expect((await readdir(repo)).filter((f) => f.endsWith(".md"))).toEqual(["a.md"]);
    expect(await readAt(repo, "draft.md", "agent/draft")).toBe("new");
    // second commit on the same branch
    await writeAndCommit(repo, "draft.md", "newer", { message: "again", author, branch: "agent/draft" });
    expect(await readAt(repo, "draft.md", "agent/draft")).toBe("newer");
  });

  it("returns a diff between commits", async () => {
    const a = await writeAndCommit(repo, "a.md", "one\n", { message: "1", author });
    const b = await writeAndCommit(repo, "a.md", "two\n", { message: "2", author });
    const d = await diff(repo, a.commit, b.commit, "a.md");
    expect(d).toContain("-one");
    expect(d).toContain("+two");
  });

  it("rejects paths that escape the vault", async () => {
    await expect(writeAndCommit(repo, "../evil.md", "x", { message: "m", author })).rejects.toThrow(/escapes/);
    await expect(writeAndCommit(repo, "/etc/evil.md", "x", { message: "m", author })).rejects.toThrow(/escapes/);
    expect(await readFile(join(repo, "..", "evil.md")).catch(() => null)).toBeNull();
  });

  it("lastCommitFor is null for an unknown file or empty repo", async () => {
    expect(await lastCommitFor(repo, "nope.md")).toBeNull();
  });

  it("queues concurrent writers instead of failing on git's index lock", async () => {
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => writeAndCommit(repo, `n/${i}.md`, `note ${i}`, { message: `add ${i}`, author })));
    expect(results.filter((r) => r.status === "rejected")).toEqual([]);
    expect(new Set(results.map((r) => (r as PromiseFulfilledResult<{ commit: string }>).value.commit)).size).toBe(20);
    expect((await fileLog(repo, "n/19.md")).length).toBe(1);
  });

  it("serializes mixed direct and branch writes, and keeps the conflict check inside the queue", async () => {
    const first = await writeAndCommit(repo, "a.md", "v1", { message: "a", author });
    const racing = await Promise.allSettled([
      writeAndCommit(repo, "a.md", "from-1", { message: "one", author, baseCommit: first.commit }),
      writeAndCommit(repo, "a.md", "from-2", { message: "two", author, baseCommit: first.commit }),
      writeAndCommit(repo, "b.md", "agent", { message: "agent", author, branch: "agent/x" }),
    ]);
    // Exactly one of the two direct writers wins; the loser sees a conflict, not a corrupted repo.
    const direct = racing.slice(0, 2);
    expect(direct.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((direct.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    expect(racing[2]?.status).toBe("fulfilled");
  });
});
