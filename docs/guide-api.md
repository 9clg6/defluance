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

## Endpoints

Notes: `GET /stats` (notes by type and status, for the spaces you can read), `GET/POST /notes`, `GET/PUT /notes/{id}`, `PATCH /notes/{id}/status`, `GET/POST /notes/{id}/links`, `GET /notes/{id}/history`, `POST /notes/{id}/issues`. Search and graph: `/search`, `/graph/neighbors`, `/graph/path`, `/graph/impact`, `/graph/lint`, `/graph/overview`, `/ask`. Administration: `/tokens`, `/spaces/{space}/members`, `/audit`, `/index/status`, `/index/rebuild`, `/github/status`, `/github/resync`, `/schema`, `/me`.
