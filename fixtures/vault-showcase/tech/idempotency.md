---
type: technical-spec
status: implemented
owner: clement
tags: [core, api]
links:
  - "[[tech/payment-service|related]]"
  - "[[tech/job-queue|related]]"
---
# Idempotency

Retrying a request must never charge twice. Every mutating endpoint that creates money-related state accepts an `Idempotency-Key` header, 8 to 64 characters.

## Behaviour

The first request with a key stores `(workspace, key, request hash)` and its response for 24 hours. A second request with the same key and the same body returns the stored response. The same key with a different body answers `422` and changes nothing.

Concurrent requests with the same key wait on a row lock, so only one executes. Keys are scoped to a workspace and never reused across endpoints.

## Internal use

The payment service derives its own key for every PSP call from the payment intent id and the attempt number, so a crash between the call and the database write cannot produce a second charge.
