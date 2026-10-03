import type { Db } from "./db.js";

export type Handler = (payload: unknown) => Promise<void>;

export interface Job {
  id: string;
  kind: string;
  payload: unknown;
  attempts: number;
}

export const MAX_ATTEMPTS = 5;

/** Persistent job queue: survives restarts, retries with exponential backoff. One worker per process. */
export class JobQueue {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Jobs left `running` by a crash go back to `pending`. Call once at startup. */
  async recover(): Promise<void> {
    await this.db.run("UPDATE jobs SET status = 'pending' WHERE status = 'running'");
  }

  /**
   * `coalesce` merges the payload into an already pending job of the same kind instead of queuing another.
   */
  async enqueue(
    kind: string,
    payload: unknown,
    opts: { coalesce?: (existing: unknown, incoming: unknown) => unknown; runAfter?: Date } = {},
  ): Promise<string> {
    if (opts.coalesce) {
      const row = await this.db.get<{ id: string; payload: string }>(
        "SELECT id, payload FROM jobs WHERE kind = ? AND status = 'pending' ORDER BY created_at LIMIT 1",
        [kind],
      );
      if (row) {
        await this.db.run("UPDATE jobs SET payload = ? WHERE id = ?", [JSON.stringify(opts.coalesce(JSON.parse(row.payload), payload)), row.id]);
        return row.id;
      }
    }
    const id = crypto.randomUUID();
    const at = this.now().toISOString();
    await this.db.run(
      "INSERT INTO jobs (id, kind, payload, status, attempts, run_after, error, created_at) VALUES (?, ?, ?, 'pending', 0, ?, NULL, ?)",
      [id, kind, JSON.stringify(payload), (opts.runAfter ?? this.now()).toISOString(), at],
    );
    return id;
  }

  async pending(): Promise<number> {
    return Number((await this.db.get<{ c: number | string }>("SELECT COUNT(*) AS c FROM jobs WHERE status IN ('pending', 'running')"))?.c ?? 0);
  }

  async failed(): Promise<{ id: string; kind: string; error: string | null }[]> {
    return this.db.all("SELECT id, kind, error FROM jobs WHERE status = 'failed' ORDER BY created_at DESC LIMIT 50");
  }

  /** Run every job that is due, in order. Returns the number completed. */
  async runDue(handlers: Record<string, Handler>): Promise<number> {
    let done = 0;
    for (;;) {
      const row = await this.db.get<{ id: string; kind: string; payload: string; attempts: number }>(
        "SELECT id, kind, payload, attempts FROM jobs WHERE status = 'pending' AND run_after <= ? ORDER BY created_at LIMIT 1",
        [this.now().toISOString()],
      );
      if (!row) return done;
      await this.db.run("UPDATE jobs SET status = 'running' WHERE id = ?", [row.id]);
      const handler = handlers[row.kind];
      try {
        if (!handler) throw new Error(`no handler for job kind "${row.kind}"`);
        await handler(JSON.parse(row.payload));
        await this.db.run("DELETE FROM jobs WHERE id = ?", [row.id]);
        done++;
      } catch (e) {
        const attempts = row.attempts + 1;
        const error = e instanceof Error ? e.message : String(e);
        if (attempts >= MAX_ATTEMPTS) {
          await this.db.run("UPDATE jobs SET status = 'failed', attempts = ?, error = ? WHERE id = ?", [attempts, error, row.id]);
        } else {
          const at = new Date(this.now().getTime() + 2 ** attempts * 1000).toISOString();
          await this.db.run("UPDATE jobs SET status = 'pending', attempts = ?, error = ?, run_after = ? WHERE id = ?", [attempts, error, at, row.id]);
        }
      }
    }
  }

  start(handlers: Record<string, Handler>, intervalMs = 500): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.runDue(handlers)
        .catch(() => undefined)
        .finally(() => (this.running = false));
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
