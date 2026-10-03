import { beforeEach, describe, expect, it } from "vitest";
import { JobQueue, MAX_ATTEMPTS } from "./jobs.js";
import { dialects, openTestStore } from "./test-env.js";

describe.each(dialects)("JobQueue (%s)", (dialect) => {
  let q: JobQueue;
  let clock: number;
  let store: Awaited<ReturnType<typeof openTestStore>>;
  const now = () => new Date(clock);

  beforeEach(async () => {
    store = await openTestStore(dialect);
    clock = Date.UTC(2026, 9, 5);
    q = new JobQueue(store.db, now);
  });

  it("runs due jobs in order and deletes them", async () => {
    const seen: unknown[] = [];
    await q.enqueue("a", 1);
    clock += 1;
    await q.enqueue("a", 2);
    expect(await q.runDue({ a: async (p) => void seen.push(p) })).toBe(2);
    expect(seen).toEqual([1, 2]);
    expect(await q.pending()).toBe(0);
  });

  it("delays jobs until runAfter", async () => {
    await q.enqueue("a", 1, { runAfter: new Date(clock + 60_000) });
    const h = { a: async () => undefined };
    expect(await q.runDue(h)).toBe(0);
    clock += 60_000;
    expect(await q.runDue(h)).toBe(1);
  });

  it("retries with exponential backoff, then marks the job failed", async () => {
    await q.enqueue("boom", {});
    let calls = 0;
    const h = { boom: async () => { calls++; throw new Error("nope"); } };
    expect(await q.runDue(h)).toBe(0);
    expect(calls).toBe(1);
    expect(await q.runDue(h)).toBe(0); // backoff: not due yet
    expect(calls).toBe(1);
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      clock += 2 ** i * 1000;
      await q.runDue(h);
    }
    expect(calls).toBe(MAX_ATTEMPTS);
    expect(await q.pending()).toBe(0);
    expect(await q.failed()).toEqual([expect.objectContaining({ kind: "boom", error: "nope" })]);
    clock += 10 * 60_000;
    await q.runDue(h);
    expect(calls).toBe(MAX_ATTEMPTS); // failed jobs are not retried
  });

  it("fails jobs without a handler instead of dropping them", async () => {
    await q.enqueue("unknown", {});
    await q.runDue({});
    expect(await q.pending()).toBe(1);
  });

  it("coalesces payloads into a pending job", async () => {
    const merge = (a: unknown, b: unknown) => [...(a as string[]), ...(b as string[])];
    await q.enqueue("index", ["a.md"], { coalesce: merge });
    await q.enqueue("index", ["b.md"], { coalesce: merge });
    const seen: unknown[] = [];
    expect(await q.runDue({ index: async (p) => void seen.push(p) })).toBe(1);
    expect(seen).toEqual([["a.md", "b.md"]]);
  });

  it("recovers jobs left running by a crash", async () => {
    await q.enqueue("a", 1);
    await store.db.run("UPDATE jobs SET status = 'running'");
    expect(await q.runDue({ a: async () => undefined })).toBe(0);
    await q.recover();
    expect(await q.runDue({ a: async () => undefined })).toBe(1);
  });
});
