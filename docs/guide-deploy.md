---
type: note
status: approved
owner: clement
tags: [guide, operations]
links:
  - "[[guide-security|related]]"
  - "[[guide-github|related]]"
---
# Deployment and operations

## Docker Compose with Postgres

```bash
cp .env.example .env      # set POSTGRES_PASSWORD, DFL_SESSION_SECRET, DFL_ADMIN_TOKEN
mkdir vault               # or point VAULT_PATH at an existing git repository
docker compose up -d
```

Open `http://localhost:4000` and sign in with `DFL_ADMIN_TOKEN`. The notes stay in `./vault` on the host: back that folder up (it is a git repository, so pushing it to a remote is the backup). Everything in Postgres can be rebuilt from the vault, except tokens, members and the audit log.

For HTTPS on your own domain, set `DOMAIN` and `DFL_PUBLIC_URL=https://your.domain`, then `docker compose --profile tls up -d`. Caddy gets the certificate by itself.

## Without Docker

```bash
npx defluance serve /srv/vault --host 0.0.0.0 --port 4000
```

SQLite is used unless `DFL_DATABASE_URL` is set. The data folder (`DFL_DATA_DIR`, default `<vault>/.defluance/data`, ignored by git) holds the index and the session key.

## Environment

| Variable | Default | Meaning |
|----------|---------|---------|
| `DFL_PORT`, `DFL_HOST` | 4000, 127.0.0.1 | Listen address |
| `DFL_PUBLIC_URL` | http://localhost:4000 | Used in GitHub issue links and OAuth callbacks |
| `DFL_DATABASE_URL` | none | Postgres URL. Needs `DFL_SESSION_SECRET` |
| `DFL_DATA_DIR` | `<vault>/.defluance/data` | SQLite file and session key |
| `DFL_SESSION_SECRET` | generated (SQLite) | Signs session cookies. Required with Postgres or several instances |
| `DFL_ADMIN_TOKEN` | generated on first start | Fixed first admin token |
| `DFL_ADMINS`, `DFL_DEFAULT_ROLE` | none | Admin logins, default role |
| `DFL_ALLOWED_ORIGINS` | the public URL | Extra origins allowed to send cookie-authenticated writes |
| `DFL_RATE_LIMIT` | 300 | Requests per minute per token or user. 0 disables |
| `DFL_EMBED`, `DFL_LLM` | hash, none | Models, see the README |
| `OLLAMA_BASE_URL`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DFL_AI_BASE_URL`, `DFL_AI_API_KEY`, `AI_GATEWAY_API_KEY` | | Provider credentials |

## Changing the embedding model

Set `DFL_EMBED` to the new model and restart. The vault is re-embedded once, and unchanged text is served from a cache. `defluance index --rebuild` forces a clean rebuild.

## Monitoring

- `GET /health`: database, git, models. HTTP 503 when the database is down.
- `GET /metrics`: Prometheus text, no authentication, so keep it on a private network. Import `deploy/grafana/defluance.json` and use `deploy/prometheus.yml`.
- Logs are one JSON object per line on stdout.
- Alert on `defluance_jobs_failed > 0`: the log says why. Failed jobs (webhooks, indexing) are retried five times with growing delays.

## Scaling

One instance serves a team comfortably: on a 10,000-note vault the search p95 is about 30 ms, reading a note about 11 ms, indexing one changed note under 100 ms, and a full index takes about 10 seconds (`pnpm bench`). Run one writing instance. The in-memory rate limiter and the single background worker are not shared between instances.

## Upgrading

Pull the new image or package and restart. Database migrations run at start. The vault format is versioned in [[vault-format]].
