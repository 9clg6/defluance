---
type: note
status: approved
owner: clement
tags: [guide, security]
links:
  - "[[guide-mcp|related]]"
  - "[[guide-deploy|related]]"
---
# Security model

## Who can do what

- **People** sign in with GitHub (or a token) and get a role per **space** (a top-level folder of the vault): reader, editor or admin. `DFL_ADMINS` lists admins of every space.
- **Tokens** carry permissions (`read`, `write`, `issues`, `admin`) and a list of spaces (none means all). You can only create a token with permissions and spaces you hold yourself.
- A note outside your spaces does not exist for you: 404 rather than 403, and it never shows up in search, links, the graph or answers.

## Agents

A Bearer token without `admin` is an **agent**. It writes to a branch, creates drafts, and cannot approve. The goal is that a person always decides what becomes the source of truth. Give agents narrow tokens, one per agent. See [[guide-mcp]].

## What is checked

| Concern | Measure |
|---------|---------|
| Tokens | 32 random bytes, only a SHA-256 hash is stored, shown once, optional expiry, revocation takes effect on the next request |
| Sessions | HttpOnly, SameSite=Lax cookie, signed with HMAC, 7 days. Writes from a cookie check the Origin header |
| MCP | Bearer token only. Cookies are never accepted |
| Webhooks | HMAC SHA-256 of the raw body, constant-time comparison, rejected with 401 before any parsing |
| Paths | Note ids are validated: no `..`, absolute paths, dotfiles or backslashes. The git layer re-checks |
| Markdown | Rendered through a sanitiser, no raw HTML. Diagrams run in strict mode |
| Code execution | None. Note content is never evaluated |
| Audit | Every write is recorded with the actor, the action, the note and the commit. The log has no update or delete endpoint |
| Rate limiting | 300 requests per minute per actor by default (in memory) |

## What is not covered

- `/metrics` has no authentication: keep it on a private network.
- The rate limiter is per process. With several instances, put limits at the proxy.
- Anyone who can write to the vault folder or its git remote can change notes without going through Defluance. The audit log only covers what passes through it, git history covers the rest.
- Embeddings and answers may send note text to the model provider you configure. Use `DFL_EMBED=hash` or a local Ollama to keep everything on your machine.

## Reporting a problem

Open a private security advisory on the repository.
