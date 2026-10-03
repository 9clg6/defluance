---
type: technical-spec
status: implemented
owner: sam
tags: [platform, infra]
links:
  - "[[tech/adr-0003-postgres-job-queue|implements]]"
  - "[[tech/observability|related]]"
  - "[[tech/rate-limiting|related]]"
---
# Job queue

Background work (reminder emails, PDF rendering, webhook deliveries, reconciliation) runs on a queue stored in Postgres, following [[tech/adr-0003-postgres-job-queue]].

## Semantics

- At-least-once delivery. Handlers must be idempotent, see [[tech/idempotency]].
- Workers claim jobs with `FOR UPDATE SKIP LOCKED` and hold a lease of 60 seconds, extended by heartbeat.
- A job that fails is retried with exponential backoff up to eight times, then moved to the dead letter table and counted in the `jobs_dead` metric.
- Jobs can be scheduled for a future time. The dunning scheduler relies on that, see [[produit/dunning]].

## Capacity

About 40 jobs per second at peak, far below what one Postgres primary handles. We revisit if sustained throughput passes 500 per second.
