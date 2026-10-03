import type { Handler } from "@defluance/indexer";

/** What the server needs from the GitHub connector. */
export interface GithubPort {
  /** True for the in-process demo connector (`DFL_GITHUB=mock`): nothing leaves the machine. */
  readonly mock?: boolean;
  /** Background jobs the connector registers (webhook processing, resync). */
  handlers?(): Record<string, Handler>;
  /** What the App may do (`issues`, `pull_requests`: "read" or "write"), so the interface offers only what works. Null when unknown. */
  permissions?(): Promise<Record<string, string> | null>;
  /** `owner/repo` list the App is installed on. */
  repos(): Promise<string[]>;
  /** Check a repository through GitHub's public API, without the App. Returns its canonical `owner/name`; throws an HttpError. */
  validatePublic?(repo: string): Promise<string>;
  /** Re-read every linked public repository, one at a time, within the unauthenticated rate limit. */
  refreshPublic?(): Promise<void>;
  createIssue(repo: string, input: { title: string; body: string; labels?: string[] }): Promise<{ key: string; number: number; url: string }>;
  /** Raw webhook delivery. Verifies the signature itself. */
  handleWebhook(input: { event: string; delivery: string | null; signature: string | null; body: string }): Promise<{ status: number; message: string }>;
  /** Re-read issues and pull requests changed since the last sync. With `repo`: that repository only, in full. */
  resync(repo?: string): Promise<{ issues: number; pulls: number }>;
  /** Open a pull request from a pushed branch. */
  createPullRequest(repo: string, input: { title: string; body: string; head: string; base: string }): Promise<{ number: number; url: string }>;
  /** Post a comment on a pull request. */
  comment(repo: string, number: number, body: string): Promise<void>;
}
