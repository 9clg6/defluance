import type { Handler } from "@defluance/indexer";

/** What the server needs from the GitHub connector. */
export interface GithubPort {
  /** Background jobs the connector registers (webhook processing, resync). */
  handlers?(): Record<string, Handler>;
  /** `owner/repo` list the App is installed on. */
  repos(): Promise<string[]>;
  createIssue(repo: string, input: { title: string; body: string; labels?: string[] }): Promise<{ key: string; number: number; url: string }>;
  /** Raw webhook delivery. Verifies the signature itself. */
  handleWebhook(input: { event: string; delivery: string | null; signature: string | null; body: string }): Promise<{ status: number; message: string }>;
  /** Re-read issues and pull requests changed since the last sync. */
  resync(): Promise<{ issues: number; pulls: number }>;
  /** Post a comment on a pull request. */
  comment(repo: string, number: number, body: string): Promise<void>;
}
