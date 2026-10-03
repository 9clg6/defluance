# Changelog

## Unreleased

- Private notes: encrypted per note for the people you choose (AES-256-GCM, keys wrapped with RSA-OAEP), keys protected by a passphrase and unlocked in memory with an idle timeout, searchable by words while unlocked, with recipients you can add and remove, and keys for agents bound to their tokens. Web UI, REST API, MCP and command line (`keys`, `encrypt`, `decrypt`, `share`). See `docs/guide-private-notes.md` for what it protects and what it cannot.
- Editing a note together, live: cursors and names, a shared unsaved draft kept across restarts, conflicts reported rather than overwritten. Same process and port, nothing to configure. See `docs/guide-live-editing.md`.
- The web UI now uses Arc UI components (buttons, badges, dialogs, tabs, toasts, cards, timeline, date range picker), in our colours.
- Writing with a language model: "Generate with AI" in the editor of a draft note fills the sections of its template or improves what is written, then shows a diff to review. Nothing is saved until you save, status and owner can never be changed by the model, links to notes that do not exist are dropped, and private notes stay out unless `DFL_PRIVATE_LLM=allow`. Templates can now be edited in Settings (`GET/PUT/DELETE /api/v1/templates`), with `<!-- ai: ... -->` hints for the model that are hidden in notes written by hand.
- Add a typed link from the note page; a card on the home page with the commands to connect an agent over MCP.
- Local demo: `pnpm demo` starts a populated "Acme Pay" vault (47 notes, 10 weeks of history, drafts from agents, a private note, GitHub issues and pull requests) with a mock language model (`DFL_LLM=mock`) and mock GitHub (`DFL_GITHUB=mock`). Mocks are opt-in, logged at start and shown in `/health`.
- Drafts: what an agent writes lands on its own branch. A person reviews the diff on the Drafts page, merges it (conflicts are reported, never forced), discards it, or opens a pull request. Agents cannot approve their own drafts.
- Delete and rename notes (links that point at them are rewritten, with a warning first), a vault tree by folder, attachments (pictures, audio, video, PDF) pasted or dropped into the editor, and more of Obsidian's syntax: embedded notes and sections, callouts, highlights, inline `#tags`. See `docs/vault-format.md`.
- Robustness: a broken `.defluance/config.yaml` or an unreadable note is reported in the index status instead of stopping the server; GitHub webhook deliveries are de-duplicated; the server checks the vault is writable before starting.
- API answers are never cached (`Cache-Control: no-store`).

- Security: Content-Security-Policy and other browser headers, request body limits (413), timeouts, response compression, request ids in logs and responses, environment validation at start. The architecture document had promised these headers before they existed.
- Reliability: simultaneous saves to one vault are queued instead of failing on git's lock; the SQLite statement cache is bounded; a dropped Postgres connection no longer crashes the process.
- Fixed: setting a frontmatter field to a multi-line or long value wrote invalid YAML and corrupted the note; a value made of a no-break space was lost; a heading with nothing under it was missing from search.
- New: `GET /api/v1/stats` and a "Where the specs stand" chart on the home page; dialogs animate in and out (and stay still with reduced motion); error pages that keep your notes safe.
- Tests: cross-browser flows on Chromium, Firefox and WebKit with the e2e framework (`apps/e2e`), property-based tests for the parsers, links, chunking, glob matching, diffs and the encryption round trip, a CSP check on every page.
- Internal: the server is split into route modules and service modules; deep search uses the AI SDK's `ToolLoopAgent`; the web UI uses SWR and `useSearchParams`.

## 0.1.0

First release.

- Markdown vault with typed wikilinks, schema, templates and `defluance validate`.
- Index in SQLite or Postgres: full text, embeddings, links. Hybrid search, graph queries, impact analysis.
- REST API with OpenAPI, MCP server (HTTP and stdio) with 10 tools, scoped tokens, spaces and roles, audit log.
- Search by words, by meaning (a multilingual model that runs locally, or Ollama, OpenAI and compatible servers), or with a language model in front: reformulations, guessed filters, reranking. Vectors are prepared in the background with a progress bar. A deep mode lets the model search, read notes and follow links before it answers. `defluance eval --search` measures recall and MRR.
- Answers that cite their sources and refuse when there are none. Providers: Anthropic, OpenAI, Ollama, any OpenAI-compatible server, AI Gateway.
- GitHub connector: App and webhooks, issues and pull requests in the graph, issue creation from a note, status derived from merged pull requests, pull request impact.
- Web UI built with Next.js and ObsidianUI: reading, search palette, editor with wikilink completion and conflict detection, history with diffs, graph, settings, audit. English and French.
- Docker image and Compose file with Postgres, Prometheus metrics and a Grafana dashboard.
- License: PolyForm Noncommercial 1.0.0, with a commercial license for professional use.
