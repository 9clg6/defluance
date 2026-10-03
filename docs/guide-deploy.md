---
type: note
status: approved
owner: clement
tags: [guide, operations]
links:
  - "[[guide-security|related]]"
  - "[[guide-github|related]]"
  - "[[guide-search|related]]"
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

## One command on a small server

For a VPS you can reach over SSH, with Docker installed (it shares the machine with whatever already runs there: its own folder, its own containers, memory capped):

```bash
deploy/hetzner/deploy.sh root@203.0.113.7            # https://203-0-113-7.sslip.io
deploy/hetzner/deploy.sh root@203.0.113.7 notes.example.com
```

It builds the bundle here, copies it to `/opt/defluance`, creates the secrets in `/opt/defluance/.env` on the first run, starts Defluance (SQLite) and Caddy (automatic HTTPS, WebSocket for live editing) and commits the vault's first state. Run it again to upgrade: the vault, the data and the secrets stay. Read the admin token with `ssh root@203.0.113.7 grep ADMIN_TOKEN /opt/defluance/.env`. Ports 80 and 443 must be reachable. Back up `/opt/defluance/vault` (a git repository: set `vault_push` to send every commit to GitHub).

### Backups, secrets and the firewall on that server

- **Backups.** A systemd timer runs `/opt/defluance/backup.sh` every night at about 03:30: a git bundle of the vault (every note, all its history) and a consistent copy of the SQLite database (tokens, members, audit log), kept 14 days in `/opt/defluance/backups`. Restore with `git clone backups/<day>/vault.bundle vault` and copy `defluance.sqlite` into the data volume. These copies live on the same disk: for a copy elsewhere, link the vault to a GitHub repository (`vault_push: true`) or pull the folder with `rsync`.
- **Secrets.** To add a key without it appearing in a command line or a shell history, pipe it in: `pbpaste | ssh root@203.0.113.7 /opt/defluance/set-secret OPENROUTER_API_KEY`. It writes `/opt/defluance/.env` and restarts Defluance. For `OPENROUTER_API_KEY` it also sets `DFL_LLM=openrouter:anthropic/claude-sonnet-5.5` when `DFL_LLM` is not set; any other model of OpenRouter works: `DFL_LLM=openrouter:<model>`.
- **Firewall.** The script does not touch it, as the server may host other things. For a server that is only yours: `ufw default deny incoming && ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw enable`. Docker publishes ports around ufw: a container started with `-p 8081:8080` is open to the world whatever ufw says; bind it to `127.0.0.1:8081:8080` or drop it in the `DOCKER-USER` chain.

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
| `DFL_RSA_BITS` | 4096 | Size of the keys created for private notes: 2048, 3072 or 4096 |
| `DFL_PRIVATE_LLM` | deny | `allow` lets a language model write the answer to a question that used private notes, so their text reaches that provider |
| `DFL_RATE_LIMIT` | 300 | Requests per minute per token or user. 0 disables |
| `DFL_SESSION_SECRET` | generated (SQLite) | At least 16 characters. Required with Postgres, so that sessions survive restarts and are shared between instances |
| `DFL_EMBED`, `DFL_LLM` | hash, none | Models, see [[guide-search]] |
| `DFL_RUNTIME_DIR`, `DFL_MODEL_CACHE` | `~/.defluance/runtime`, `~/.defluance/models` | Where `DFL_EMBED=local` keeps its runtime and model |
| `OLLAMA_BASE_URL`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DFL_AI_BASE_URL`, `DFL_AI_API_KEY`, `AI_GATEWAY_API_KEY` | | Provider credentials |

## Search by meaning in Docker

```bash
docker build --build-arg EMBED=local -t defluance:local .      # bakes the model in (about 600 MB more)
# or with Compose, set DFL_EMBED=local in .env: the image is built with it
```

The published `-local` tag is the same image with the model included. A container started from the default image can use `ollama:` or `openai:` models instead.

## Changing the embedding model

Set `DFL_EMBED` to the new model and restart. The text stays searchable by words straight away, and the vault is re-embedded once in the background (progress at the top of the app). Unchanged text is served from a cache. `defluance index --rebuild` forces a clean rebuild.

## Monitoring

- `GET /health`: database, git, models. HTTP 503 when the database is down.
- `GET /metrics`: Prometheus text, no authentication, so keep it on a private network. Import `deploy/grafana/defluance.json` and use `deploy/prometheus.yml`.
- Logs are one JSON object per line on stdout.
- Alert on `defluance_jobs_failed > 0`: the log says why. Failed jobs (webhooks, indexing) are retried five times with growing delays.

## Scaling

One instance serves a team comfortably: on a 10,000-note vault the search p95 is about 30 ms, reading a note about 11 ms, indexing one changed note under 100 ms, and a full index takes about 10 seconds (`pnpm bench`). Run one writing instance. The in-memory rate limiter, the single background worker, the unlocked keys of private notes and the live editing rooms are not shared between instances: a person who unlocks a key on one instance has not unlocked it on another, and everyone editing a note must reach the same instance.

## When it will not start

- **"... is not writable by 1000:1000".** The folder is mounted from your machine and owned by someone else. Run the container as the owner of the folder (`--user "$(id -u):$(id -g)"`, or `user:` in the compose file) and make sure the data volume is writable by that user too, or change the folder's owner. Defluance checks this at start so that the first save does not fail deep inside git.
- **A vault file does not parse.** A broken `.defluance/config.yaml` or `schema.yaml` does not stop the server: it keeps the last good version (the defaults on a first start), `/health` reports `degraded` with the file and the reason, and admins see a banner. Fix the file and the problem clears without a restart; `defluance validate` shows the same error.
- **GitHub delivers a webhook twice.** The second one answers 200 `duplicate` and is not processed again.

## Upgrading

Pull the new image or package and restart. Database migrations run at start. The vault format is versioned in [[vault-format]].
