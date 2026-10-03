---
type: functional-spec
status: review
owner: nadia
tags: [auth]
acceptance_criteria:
  - The reset link is valid for one hour and works once
  - All sessions are closed after a reset
links:
  - "[[produit/auth-login|related]]"
---
# Password reset

A user who forgot the password requests a reset link by email. The link is valid for one hour and can be used once. After a reset, all active sessions are closed.

- [x] Email template
- [ ] Rate limit the request form, see [[tech/rate-limiting]]
