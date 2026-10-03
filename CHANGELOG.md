# Changelog

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
