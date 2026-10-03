---
type: technical-spec
status: approved
owner: karim
tags: [auth]
links:
  - "[[tech/adr-0001-jwt-sessions|implements]]"
---
# Sessions

Sessions are signed JWT tokens stored in an HttpOnly cookie. Access tokens expire after fifteen minutes and are renewed with a refresh token valid for seven days.

## Storage

The refresh token is stored hashed. Revoking a user deletes every refresh token of that user.
