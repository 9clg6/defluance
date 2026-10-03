---
type: note
status: approved
owner: clement
tags: [guide, api]
links:
  - "[[guide-mcp|related]]"
  - "[[guide-security|related]]"
  - "[[guide-search|related]]"
---
# REST API

The server describes itself: `GET /api/v1/openapi.json` (OpenAPI 3.1, no authentication needed).

## Conventions

- Send `Authorization: Bearer dfl_...`. A browser session cookie also works from the interface, with an origin check on writes.
- A note is identified by its **id**: the path without `.md`, such as `produit/auth-login`. In a URL path, encode it as one segment: `/api/v1/notes/produit%2Fauth-login`.
- Errors are `application/problem+json` with `status`, `title` and sometimes `errors`. 401 no or bad token, 403 missing permission, 404 unknown **or hidden** note, 409 conflict, 422 invalid input, 429 slow down (`Retry-After`).
- Every write returns the SHA of the commit it created.

## Read

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:4000/api/v1/search?q=password+reset&type=functional-spec"

curl -H "Authorization: Bearer $TOKEN" "http://localhost:4000/api/v1/notes/produit%2Fauth-login"
curl -H "Authorization: Bearer $TOKEN" "http://localhost:4000/api/v1/notes/produit%2Fauth-login/links"
curl -H "Authorization: Bearer $TOKEN" "http://localhost:4000/api/v1/graph/impact?id=tech%2Fsessions"
curl -H "Authorization: Bearer $TOKEN" "http://localhost:4000/api/v1/graph/impact?pr=acme%2Fapp%2312"
```

## Write without overwriting anyone

```bash
# read: the response has "commit"
NOTE=$(curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:4000/api/v1/notes/tech%2Fwebhooks")

# write: pass it back as base_commit. If the note changed meanwhile you get 409 and the current commit.
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  "http://localhost:4000/api/v1/notes/tech%2Fwebhooks" \
  -d '{"content":"---\ntype: technical-spec\nstatus: draft\nowner: karim\n---\n# Webhooks\n...","base_commit":"<commit>"}'
```

## Search modes

```bash
# words, meaning, or both (default). `passages=3` returns up to three passages per note.
curl -H "Authorization: Bearer $TOKEN" "http://localhost:4000/api/v1/search?q=password+recovery&mode=meaning&passages=3"

# a language model in front: reformulations, guessed filters, optional rerank. `understood` says what it did.
curl -H "Authorization: Bearer $TOKEN" "http://localhost:4000/api/v1/search/smart?q=approved+specs+about+logins&rerank=true"
```

`GET /api/v1/me` and `GET /api/v1/index/status` return `capabilities` (`semantic`, `llm`, `deep`, and the embedder), and `index/status` has the progress of the vectors being prepared. See [[guide-search]].

## Ask

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  http://localhost:4000/api/v1/ask \
  -d '{"question":"How long is a reset link valid?","scope_note":"produit/password-reset"}'
# add "deep": true to let the model search, read and follow links over several steps; the answer then has "steps"
```

```json
{
  "answer": "The link is valid for one hour [1].",
  "citations": [{ "n": 1, "note": "produit/password-reset", "heading": "Password reset", "commit": "9f2c1ab…" }],
  "refused": false,
  "mode": "llm"
}
```

When no note supports an answer, `refused` is true and nothing is invented. A citation is always a passage that was retrieved, never one the model made up.

## Draft a note with the language model

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  "http://localhost:4000/api/v1/notes/produit%2Fpassword-reset/generate" \
  -d '{"mode":"fill","instruction":"add rate limiting rules"}'
```

`mode` is `fill` (complete the sections from the note's template) or `improve` (rewrite following `instruction`; default: clarity, completeness, testable acceptance criteria). `content` is optional unsaved editor text and replaces the stored text as input. Nothing is written or committed: the answer is a proposal.

```json
{
  "content": "---\ntype: functional-spec\nstatus: draft\n...",
  "model": "anthropic:claude-sonnet-5-5",
  "grounded_on": [{ "id": "tech/sessions", "title": "Sessions" }],
  "links": [{ "to": "tech/sessions", "type": "depends_on" }],
  "warnings": ["removed a link to \"ghost\": no such note"]
}
```

The rules are enforced on the returned text, not left to the prompt: it parses, `type`, `status` and `owner` are those of the stored note, a code fence around the whole answer is removed, and links to notes that do not exist are dropped (and listed in `warnings`). Output that does not parse is retried once, then 422. Needs `write` on the note's space (agents get 403). 503 when no model is configured (`DFL_LLM`). A private note is refused with 422 unless the operator set `DFL_PRIVATE_LLM=allow` and your key is unlocked (423 otherwise); private notes are never given to the model as context for another note. Audited as `note.generate` (id, mode, model; no text).

## Templates

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/v1/templates
# {"items":[{"name":"adr","source":"builtin","content":"---\ntype: {{type}}..."}]}

curl -X PUT -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  http://localhost:4000/api/v1/templates/rfc -d '{"content":"---\ntype: {{type}}\nstatus: draft\nowner: {{owner}}\n---\n# {{title}}\n\n## Summary\n<!-- ai: two sentences -->\n"}'
# {"name":"rfc","commit":"9f2c1ab…"}

curl -X DELETE -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/v1/templates/rfc
```

`source` is `builtin`, `vault` (a file with a new name) or `override` (a file replacing a built-in; deleting it brings the built-in back). Any signed-in reader can list. `PUT` and `DELETE` need admin on every space and are never open to agents; each is a commit `template: <name>` and is audited. Names match `^[a-z][a-z0-9-]{0,40}$`; a template is at most 20 KB (413) and must render, with sample values, to a note that parses and sets `type`, `status` and `owner` (422). `DELETE` answers 404 when the vault has no such file. `<!-- ai: ... -->` comments guide the model and are stripped from notes created by hand. See [[vault-format]].

## Endpoints

Notes: `GET /stats` (notes by type and status, for the spaces you can read), `GET/POST /notes`, `GET/PUT /notes/{id}`, `POST /notes/{id}/generate`, `PATCH /notes/{id}/status`, `GET/POST /notes/{id}/links`, `GET /notes/{id}/history`, `POST /notes/{id}/issues`. Templates: `GET /templates`, `PUT/DELETE /templates/{name}`. Search and graph: `/search`, `/graph/neighbors`, `/graph/path`, `/graph/impact`, `/graph/lint`, `/graph/overview`, `/ask`. Private notes: `GET/POST /keys`, `POST /keys/{fp}/unlock`, `POST /keys/{fp}/lock`, `POST /keys/lock`, `GET /keys/{fp}/backup`, `DELETE /keys/{fp}`, `POST /notes/{id}/encrypt`, `POST /notes/{id}/decrypt`, `PUT /notes/{id}/recipients`. Live editing is a WebSocket on `/collab/{note id}`, see [[guide-live-editing]]. GitHub: `PUT /github/repos` takes `{repo, space?, linked, public?}`; `public: true` links a public repository read through GitHub's unauthenticated API, without installing the App (read-only, 60 requests per hour, refreshed every 15 minutes), and `GET /github/status` lists such repositories in `publicRepos` and their last sync in `publicSync`, see [[guide-github]]. Administration: `/tokens`, `/spaces/{space}/members`, `/audit`, `/index/status`, `/index/rebuild`, `/github/status`, `/github/resync`, `/github/items`, `/github/repos`, `/schema`, `/me`.
