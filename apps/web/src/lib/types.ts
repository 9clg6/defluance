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
}

export interface NoteDetail extends NoteSummary {
  path: string;
  frontmatter: Record<string, unknown>;
  headings: { depth: number; text: string; line: number }[];
  body: string;
  raw: string;
  commit: string | null;
  rev: string | null;
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
