import { createHash, randomBytes } from "node:crypto";
import { migrate, type Db, type Migration, type Row } from "@defluance/indexer";

export const PERMS = ["read", "write", "issues", "admin"] as const;
export type Perm = (typeof PERMS)[number];
export const ROLES = ["reader", "editor", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_PERMS: Record<Role, Perm[]> = {
  reader: ["read"],
  editor: ["read", "write", "issues"],
  admin: ["read", "write", "issues", "admin"],
};

export const systemMigrations: Migration[] = [
  {
    id: "system-001",
    up: () => `
CREATE TABLE users (
  id TEXT PRIMARY KEY, github_id TEXT UNIQUE, login TEXT NOT NULL UNIQUE, name TEXT, avatar TEXT,
  created_at TEXT NOT NULL, last_login_at TEXT
);
CREATE TABLE memberships (
  user_id TEXT NOT NULL, space TEXT NOT NULL, role TEXT NOT NULL, PRIMARY KEY (user_id, space)
);
CREATE TABLE tokens (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL, spaces TEXT NOT NULL,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT, revoked_at TEXT, last_used_at TEXT
);
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY, at TEXT NOT NULL, actor_type TEXT NOT NULL, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL,
  action TEXT NOT NULL, target TEXT, payload TEXT NOT NULL, commit_sha TEXT
);
CREATE INDEX audit_at ON audit_log(at);
CREATE INDEX audit_target ON audit_log(target);
`,
  },
  {
    id: "system-002",
    up: () => `
CREATE TABLE keys (
  fp TEXT PRIMARY KEY, owner_kind TEXT NOT NULL, owner_id TEXT NOT NULL, label TEXT NOT NULL,
  public_pem TEXT NOT NULL, protected TEXT NOT NULL, bound TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX keys_owner ON keys(owner_id);
`,
  },
];

export interface KeyRow {
  fp: string;
  owner_kind: "user" | "token";
  owner_id: string;
  label: string;
  public_pem: string;
  /** Passphrase-protected private key (JSON). Never leaves the server except as the owner's own backup. */
  protected: string;
  /** `passphrase`: the owner types it. `token`: the API token itself is the passphrase (agents). */
  bound: "passphrase" | "token";
  created_at: string;
}

export interface TokenRow {
  id: string;
  name: string;
  scopes: Perm[];
  /** Empty = every space. */
  spaces: string[];
  created_by: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
}

export interface UserRow {
  id: string;
  github_id: string | null;
  login: string;
  name: string | null;
  avatar: string | null;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor_type: string;
  actor_id: string;
  actor_name: string;
  action: string;
  target: string | null;
  payload: Record<string, unknown>;
  commit_sha: string | null;
}

export interface AuditFilter {
  actor?: string | undefined;
  action?: string | undefined;
  target?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  limit?: number | undefined;
  before?: string | undefined;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const toToken = (r: Row): TokenRow => ({
  id: r["id"] as string,
  name: r["name"] as string,
  scopes: JSON.parse(r["scopes"] as string) as Perm[],
  spaces: JSON.parse(r["spaces"] as string) as string[],
  created_by: r["created_by"] as string,
  created_at: r["created_at"] as string,
  expires_at: (r["expires_at"] as string | null) ?? null,
  revoked_at: (r["revoked_at"] as string | null) ?? null,
  last_used_at: (r["last_used_at"] as string | null) ?? null,
});
const toUser = (r: Row): UserRow => ({
  id: r["id"] as string,
  github_id: (r["github_id"] as string | null) ?? null,
  login: r["login"] as string,
  name: (r["name"] as string | null) ?? null,
  avatar: (r["avatar"] as string | null) ?? null,
});

export class SystemStore {
  private constructor(
    readonly db: Db,
    private readonly now: () => Date,
  ) {}

  static async open(db: Db, now: () => Date = () => new Date()): Promise<SystemStore> {
    await migrate(db, systemMigrations);
    return new SystemStore(db, now);
  }

  // ---- tokens

  /** The plaintext is returned once and never stored. */
  async createToken(input: { name: string; scopes: Perm[]; spaces: string[]; createdBy: string; expiresInDays?: number | null }): Promise<{ token: string; row: TokenRow }> {
    const token = `dfl_${randomBytes(32).toString("base64url")}`;
    const id = crypto.randomUUID();
    const at = this.now();
    const expires = input.expiresInDays ? new Date(at.getTime() + input.expiresInDays * 86_400_000).toISOString() : null;
    await this.db.run(
      `INSERT INTO tokens (id, name, hash, scopes, spaces, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.name, sha256(token), JSON.stringify(input.scopes), JSON.stringify(input.spaces), input.createdBy, at.toISOString(), expires],
    );
    return { token, row: (await this.getToken(id)) as TokenRow };
  }

  /** Make sure this exact token exists (docker-compose bootstrap). Returns false if it was already there. */
  async ensureToken(plaintext: string, input: { name: string; scopes: Perm[]; createdBy: string }): Promise<boolean> {
    if (await this.db.get("SELECT 1 AS x FROM tokens WHERE hash = ?", [sha256(plaintext)])) return false;
    await this.db.run(
      `INSERT INTO tokens (id, name, hash, scopes, spaces, created_by, created_at) VALUES (?, ?, ?, ?, '[]', ?, ?)`,
      [crypto.randomUUID(), input.name, sha256(plaintext), JSON.stringify(input.scopes), input.createdBy, this.now().toISOString()],
    );
    return true;
  }

  async getToken(id: string): Promise<TokenRow | null> {
    const r = await this.db.get("SELECT * FROM tokens WHERE id = ?", [id]);
    return r ? toToken(r) : null;
  }

  /** Valid token for this plaintext: not revoked, not expired. Touches `last_used_at` at most once a minute. */
  async findToken(plaintext: string): Promise<TokenRow | null> {
    if (!plaintext.startsWith("dfl_")) return null;
    const r = await this.db.get("SELECT * FROM tokens WHERE hash = ?", [sha256(plaintext)]);
    if (!r) return null;
    const t = toToken(r);
    const now = this.now();
    if (t.revoked_at || (t.expires_at && new Date(t.expires_at) <= now)) return null;
    if (!t.last_used_at || now.getTime() - new Date(t.last_used_at).getTime() > 60_000) {
      await this.db.run("UPDATE tokens SET last_used_at = ? WHERE id = ?", [now.toISOString(), t.id]);
    }
    return t;
  }

  async listTokens(): Promise<TokenRow[]> {
    return (await this.db.all("SELECT * FROM tokens WHERE revoked_at IS NULL ORDER BY created_at DESC")).map(toToken);
  }

  async revokeToken(id: string): Promise<void> {
    await this.db.run("UPDATE tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", [this.now().toISOString(), id]);
  }

  async tokenCount(): Promise<number> {
    return Number((await this.db.get<{ c: number | string }>("SELECT COUNT(*) AS c FROM tokens WHERE revoked_at IS NULL"))?.c ?? 0);
  }

  // ---- keys (the private half stays protected by a passphrase; see keys.ts)

  async addKey(k: Omit<KeyRow, "created_at">): Promise<KeyRow> {
    const at = this.now().toISOString();
    await this.db.run(`INSERT INTO keys (fp, owner_kind, owner_id, label, public_pem, protected, bound, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [k.fp, k.owner_kind, k.owner_id, k.label, k.public_pem, k.protected, k.bound, at]);
    return { ...k, created_at: at };
  }

  async getKey(fp: string): Promise<KeyRow | null> {
    return ((await this.db.get("SELECT * FROM keys WHERE fp = ?", [fp])) as KeyRow | undefined) ?? null;
  }

  async keysOf(ownerId: string): Promise<KeyRow[]> {
    return (await this.db.all("SELECT * FROM keys WHERE owner_id = ? ORDER BY created_at", [ownerId])) as unknown as KeyRow[];
  }

  async allKeys(): Promise<KeyRow[]> {
    return (await this.db.all("SELECT * FROM keys ORDER BY created_at")) as unknown as KeyRow[];
  }

  async deleteKey(fp: string): Promise<void> {
    await this.db.run("DELETE FROM keys WHERE fp = ?", [fp]);
  }

  // ---- users and memberships

  async upsertUser(u: { githubId: string; login: string; name?: string | null; avatar?: string | null }): Promise<UserRow> {
    const at = this.now().toISOString();
    const existing = await this.db.get("SELECT * FROM users WHERE github_id = ?", [u.githubId]);
    if (existing) {
      await this.db.run("UPDATE users SET login = ?, name = ?, avatar = ?, last_login_at = ? WHERE id = ?", [u.login, u.name ?? null, u.avatar ?? null, at, existing["id"] as string]);
      return toUser((await this.db.get("SELECT * FROM users WHERE id = ?", [existing["id"] as string])) as Row);
    }
    const id = crypto.randomUUID();
    await this.db.run("INSERT INTO users (id, github_id, login, name, avatar, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [id, u.githubId, u.login, u.name ?? null, u.avatar ?? null, at, at]);
    return toUser((await this.db.get("SELECT * FROM users WHERE id = ?", [id])) as Row);
  }

  async getUser(id: string): Promise<UserRow | null> {
    const r = await this.db.get("SELECT * FROM users WHERE id = ?", [id]);
    return r ? toUser(r) : null;
  }

  async userByLogin(login: string): Promise<UserRow | null> {
    const r = await this.db.get("SELECT * FROM users WHERE login = ?", [login]);
    return r ? toUser(r) : null;
  }

  /** Create a user that has not signed in yet, so an admin can grant a role in advance. */
  async ensureUserByLogin(login: string): Promise<UserRow> {
    const existing = await this.userByLogin(login);
    if (existing) return existing;
    const id = crypto.randomUUID();
    await this.db.run("INSERT INTO users (id, github_id, login, name, avatar, created_at, last_login_at) VALUES (?, NULL, ?, NULL, NULL, ?, NULL)", [id, login, this.now().toISOString()]);
    return (await this.getUser(id)) as UserRow;
  }

  async memberships(userId: string): Promise<{ space: string; role: Role }[]> {
    return this.db.all("SELECT space, role FROM memberships WHERE user_id = ?", [userId]) as never;
  }

  async members(space: string): Promise<{ user: UserRow; role: Role }[]> {
    const rows = await this.db.all<Row>(
      "SELECT u.*, m.role AS _role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.space = ? ORDER BY u.login",
      [space],
    );
    return rows.map((r) => ({ user: toUser(r), role: r["_role"] as Role }));
  }

  async setRole(userId: string, space: string, role: Role): Promise<void> {
    await this.db.run(
      "INSERT INTO memberships (user_id, space, role) VALUES (?, ?, ?) ON CONFLICT (user_id, space) DO UPDATE SET role = excluded.role",
      [userId, space, role],
    );
  }

  async removeMember(userId: string, space: string): Promise<void> {
    await this.db.run("DELETE FROM memberships WHERE user_id = ? AND space = ?", [userId, space]);
  }

  // ---- audit (append only: there is no update or delete)

  async audit(e: { actorType: string; actorId: string; actorName: string; action: string; target?: string | null; payload?: Record<string, unknown>; commit?: string | null }): Promise<void> {
    await this.db.run(
      "INSERT INTO audit_log (id, at, actor_type, actor_id, actor_name, action, target, payload, commit_sha) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [crypto.randomUUID(), this.now().toISOString(), e.actorType, e.actorId, e.actorName, e.action, e.target ?? null, JSON.stringify(e.payload ?? {}), e.commit ?? null],
    );
  }

  async listAudit(f: AuditFilter = {}): Promise<AuditEntry[]> {
    const where: string[] = [];
    const params: (string | number)[] = [];
    const eq = (col: string, v: string | undefined) => {
      if (v) {
        where.push(`${col} = ?`);
        params.push(v);
      }
    };
    eq("actor_name", f.actor);
    eq("action", f.action);
    eq("target", f.target);
    const bound = (sql: string, v: string | undefined) => {
      if (v) {
        where.push(sql);
        params.push(v);
      }
    };
    bound("at >= ?", f.from);
    bound("at <= ?", f.to);
    bound("at < ?", f.before);
    params.push(Math.min(f.limit ?? 100, 500));
    const rows = await this.db.all<Row>(`SELECT * FROM audit_log ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY at DESC, id DESC LIMIT ?`, params);
    return rows.map((r) => ({
      id: r["id"] as string,
      at: r["at"] as string,
      actor_type: r["actor_type"] as string,
      actor_id: r["actor_id"] as string,
      actor_name: r["actor_name"] as string,
      action: r["action"] as string,
      target: (r["target"] as string | null) ?? null,
      payload: JSON.parse(r["payload"] as string) as Record<string, unknown>,
      commit_sha: (r["commit_sha"] as string | null) ?? null,
    }));
  }
}
