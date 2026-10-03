---
type: adr
status: approved
owner: karim
tags: [auth]
---
# ADR 1: Signed tokens for sessions

## Context

We need stateless session checks on every request.

## Decision

Use short-lived signed JWT access tokens with a refresh token.

## Consequences

Revocation relies on the refresh token, so access tokens stay valid until they expire.
