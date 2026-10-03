import type { Migration } from "./db.js";

const blob = (d: string) => (d === "sqlite" ? "BLOB" : "BYTEA");

/** Postgres 'simple' config keeps accents. Fold them so "réinitialiser" matches "reinitialiser" (SQLite does this natively). */
const fold = (col: string) => `translate(lower(${col}), 'àáâãäåçèéêëìíîïñòóôõöùúûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy')`;

/** Index tables. Everything here is derived from the vault and can be dropped and rebuilt. */
export const indexMigrations: Migration[] = [
  {
    id: "index-001",
    up: (d) => `
CREATE TABLE notes (
  id TEXT PRIMARY KEY, path TEXT NOT NULL, space TEXT NOT NULL,
  type TEXT, status TEXT, owner TEXT, title TEXT NOT NULL,
  tags TEXT NOT NULL, frontmatter TEXT NOT NULL, headings TEXT NOT NULL,
  content_hash TEXT NOT NULL, commit_sha TEXT, updated_at TEXT NOT NULL
);
CREATE INDEX notes_filter ON notes(space, type, status);

${
  d === "sqlite"
    ? `CREATE TABLE chunks (
  rid INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, note_id TEXT NOT NULL,
  title TEXT NOT NULL, heading TEXT NOT NULL, ordinal INTEGER NOT NULL,
  content TEXT NOT NULL, content_hash TEXT NOT NULL, embedding ${blob(d)}, commit_sha TEXT
);
CREATE INDEX chunks_note ON chunks(note_id);
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  content, heading, title, content='chunks', content_rowid='rid', tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, content, heading, title) VALUES (new.rid, new.content, new.heading, new.title);
END;
CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, content, heading, title) VALUES ('delete', old.rid, old.content, old.heading, old.title);
END;`
    : `CREATE TABLE chunks (
  id TEXT PRIMARY KEY, note_id TEXT NOT NULL,
  title TEXT NOT NULL, heading TEXT NOT NULL, ordinal INTEGER NOT NULL,
  content TEXT NOT NULL, content_hash TEXT NOT NULL, embedding ${blob(d)}, commit_sha TEXT,
  tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', ${fold("title")}), 'B') || setweight(to_tsvector('simple', ${fold("heading")}), 'B') || to_tsvector('simple', ${fold("content")})
  ) STORED
);
CREATE INDEX chunks_note ON chunks(note_id);
CREATE INDEX chunks_tsv ON chunks USING GIN (tsv);`
}

CREATE TABLE edges (
  id TEXT PRIMARY KEY, from_note TEXT NOT NULL, to_ref TEXT NOT NULL, heading TEXT,
  kind TEXT NOT NULL, link_type TEXT NOT NULL, source TEXT NOT NULL, line INTEGER NOT NULL, to_note TEXT
);
CREATE INDEX edges_from ON edges(from_note);
CREATE INDEX edges_to ON edges(to_note);

CREATE TABLE gh_nodes (
  key TEXT PRIMARY KEY, kind TEXT NOT NULL, state TEXT NOT NULL, title TEXT NOT NULL,
  labels TEXT NOT NULL, author TEXT, files TEXT NOT NULL, merged_at TEXT, url TEXT, updated_at TEXT NOT NULL
);

CREATE TABLE embedding_cache (
  model TEXT NOT NULL, hash TEXT NOT NULL, vector ${blob(d)} NOT NULL, PRIMARY KEY (model, hash)
);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL,
  attempts INTEGER NOT NULL, run_after TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL
);
CREATE INDEX jobs_due ON jobs(status, run_after);
`,
  },
];
