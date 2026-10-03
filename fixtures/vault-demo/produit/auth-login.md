---
type: functional-spec
status: implemented
owner: nadia
tags: [auth, v1]
acceptance_criteria:
  - Five failed attempts lock the account for fifteen minutes
  - Google sign-in is available
links:
  - "[[tech/sessions|depends_on]]"
  - "[[gh:acme/app#12|tracked_by]]"
---
# Login

Users sign in with their email address and a password. After five failed attempts the account is locked for fifteen minutes. Sign-in with a Google account is supported through OAuth.

## Flow

```mermaid
sequenceDiagram
  User->>App: email + password
  App->>Sessions: create session
  Sessions-->>User: cookie
```

See [[produit/password-reset]] when a user forgot the password, and [[tech/adr-0001-jwt-sessions#Decision]] for why sessions are signed tokens.
