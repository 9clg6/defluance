---
type: note
status: approved
owner: clement
tags: [incident, payments]
links:
  - "[[tech/payment-service|related]]"
  - "[[tech/idempotency|related]]"
  - "[[tech/psp-integration|related]]"
---
# Incident: PSP timeouts, 19 August

**Impact:** 41 minutes during which 18% of card payments timed out. 212 customers saw an error, 9 were charged but not marked paid.

## Timeline

- 09:12 UTC: confirm error rate climbs. Page fires at 09:17.
- 09:40: we find the PSP is slow in one region. We increase the client timeout, which makes it worse.
- 09:58: timeout restored, PSP recovers.
- 11:30: the 9 charged payments are fixed by running the reconciliation job by hand.

## What went well

Idempotency keys ([[tech/idempotency]]) meant nobody was charged twice despite the client retrying.

## Follow-ups

- [x] Reconcile unknown outcomes automatically after a timeout, see [[tech/payment-service]]
- [x] Alert on PSP latency, not only on our error rate
- [ ] Evaluate a second PSP, tracked in [[tech/adr-0006-psp-abstraction]]
