---
type: component
status: approved
owner: karim
tags: [auth]
paths:
  - src/auth/**
  - docs/auth.md
links:
  - "[[produit/auth-login|implements]]"
  - "[[tech/sessions|depends_on]]"
---
# Auth module

Owns login, sessions and password reset in the codebase. A pull request touching `src/auth/` is linked to this component and, through it, to the login spec.
