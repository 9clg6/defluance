---
type: adr
status: approved
owner: clement
tags: [core, events]
links:
  - "[[tech/webhooks|related]]"
  - "[[tech/payment-service|related]]"
---
# ADR 5: Transactional outbox for events

## Context

We emit events (webhooks, emails, analytics) after a state change. Publishing straight after the commit can fail and lose the event; publishing before it can announce something that rolls back.

## Decision

Write the event to an `outbox` table in the same transaction as the change. A relay reads the table in order and hands events to the job queue.

## Consequences

Events are delivered at least once and in order per aggregate. Consumers must deduplicate on the event id. The relay is a single worker with a lease; throughput is ample for our volume.
