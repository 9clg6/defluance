export interface Me {
  kind: "user" | "token";
  id: string;
  name: string;
  spaces: { name: string; path: string; repos: string[]; perms: string[] }[];
  oauth: boolean;
  local: boolean;
  capabilities: Capabilities;
}

/** What search can do on this server: the interface only offers what works. */
export interface Capabilities {
  /** Real embedding model: search by meaning. */
  semantic: boolean;
  embedder: string;
  llm: string | null;
  deep: boolean;
  /** Several people can edit a note at once and see each other. */
  collab: boolean;
}

export interface NoteSummary {
  id: string;
  title: string;
  type: string | null;
  status: string | null;
  owner: string | null;
  space: string;
  tags: string[];
  updated_at: string;
  /** The note is encrypted. */
  private?: boolean;
  /** An encrypted note whose text this person cannot read right now: the title is the file name. */
  locked?: boolean;
}

/** A key that can read a private note. */
export interface Recipient {
  fp: string;
  label: string;
  owner: string | null;
}

export interface KeyStatus {
  fp: string;
  label: string;
  bound: "passphrase" | "token";
  created_at: string;
  unlocked: boolean;
  expires_at: string | null;
}

export interface KeyringEntry {
  fp: string;
  label: string;
  owner: string;
  created: string;
}

export interface DraftFile {
  path: string;
  id: string | null;
  status: "A" | "M" | "D" | string;
  private: boolean;
}

/** What an agent wrote on a branch, waiting for a person. */
export interface Draft {
  branch: string;
  agent: string;
  files: DraftFile[];
  commits: number;
  last: { date: string; author: string; message: string };
  mergeable: boolean | null;
}

export interface DraftDetail extends Omit<Draft, "files"> {
  files: (DraftFile & { patch: string })[];
}

export interface KeysResponse {
  mine: KeyStatus[];
  keyring: KeyringEntry[];
}

export interface NoteDetail extends NoteSummary {
  path: string;
  frontmatter: Record<string, unknown>;
  headings: { depth: number; text: string; line: number }[];
  body: string;
  raw: string;
  commit: string | null;
  rev: string | null;
  /** Private notes only. */
  recipients?: Recipient[];
  /** Why a locked note is locked: a key to unlock, no key at all, or not a recipient. */
  reason?: "locked" | "not-recipient" | "no-key";
  /** The keys of yours that would open a locked note. */
  keys?: string[];
}

export interface GhNode {
  key: string;
  kind: "issue" | "pull-request";
  state: "open" | "closed" | "merged";
  title: string;
  labels: string[];
  author: string | null;
  url: string | null;
}

export interface LinkView {
  type: string;
  kind: "note" | "github";
  target: string;
  heading: string | null;
  line: number;
  source: string;
  note: { id: string; title: string; type: string | null; status: string | null } | null;
  github: GhNode | null;
  broken: boolean;
}

export interface IncomingLink {
  type: string;
  line: number;
  from: { id: string; title: string; type: string | null; status: string | null };
}

export interface NoteLinks {
  id: string;
  outgoing: Record<string, LinkView[]>;
  incoming: Record<string, IncomingLink[]>;
}

export interface SearchHit {
  note: { id: string; title: string; type: string | null; status: string | null; space: string; tags: string[] };
  chunk: { id: string; heading: string; snippet: string; commit: string | null };
  more?: { id: string; heading: string; snippet: string; commit: string | null }[];
  score: number;
  vector?: number;
  sources: ("fts" | "vector")[];
  /** Found in an encrypted note, with a key that is unlocked. */
  private?: boolean;
}

export type SearchMode = "hybrid" | "keyword" | "meaning" | "smart";

export interface Understood {
  queries: string[];
  filters: { type?: string; status?: string; tag?: string };
  filtersDropped: boolean;
  reranked: boolean;
  fallback?: string;
}

export interface SmartResult {
  hits: SearchHit[];
  understood: Understood;
}

export interface GraphNode {
  id: string;
  title: string;
  type: string | null;
  status: string | null;
  depth: number;
}
export interface GraphEdge {
  from: string;
  to: string;
  type: string;
}
export interface Subgraph {
  root?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
}

export interface Citation {
  n: number;
  note: string;
  title: string;
  heading: string;
  commit: string | null;
  snippet: string;
}
export interface AskResult {
  answer: string;
  citations: Citation[];
  refused: boolean;
  mode: "llm" | "extractive" | "deep";
  /** Private notes were used, so the answer was written without the language model. */
  llmWithheld?: boolean;
  steps?: { tool: string; input: string; summary: string }[];
}

export interface VaultSchema {
  types: Record<string, { required: string[] }>;
  statuses: string[];
  linkTypes: string[];
}

export interface WriteResult {
  id: string;
  commit: string;
  branch: string | null;
  diagnostics: { rule: string; message: string; severity: string }[];
}

export interface Commit {
  hash: string;
  date: string;
  message: string;
  author: string;
}

export interface TokenRow {
  id: string;
  name: string;
  scopes: string[];
  spaces: string[];
  created_by: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor_type: string;
  actor_name: string;
  action: string;
  target: string | null;
  payload: Record<string, unknown>;
  commit_sha: string | null;
}

export interface IndexStatus {
  notes: number;
  chunks: number;
  edges: number;
  embedded: number;
  embed_model: string | null;
  last_commit: string | null;
  indexed_at: string | null;
  jobs_pending: number;
  jobs_failed: number;
  pending: number;
  embedding: { running: boolean; done: number; total: number; error: string | null; pending: number };
  capabilities: Capabilities;
}

export interface GithubStatus {
  configured: boolean;
  repos: string[];
  spaces: { name: string; repos: string[] }[];
  defaultRepos: string[];
  webhookUrl: string;
  oauth: boolean;
}

export interface NoteStats {
  total: number;
  groups: { type: string; total: number; statuses: Record<string, number> }[];
}
