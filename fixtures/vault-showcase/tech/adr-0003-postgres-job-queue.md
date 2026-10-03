---
type: adr
status: implemented
owner: sam
tags: [platform, queue]
links:
  - "[[tech/adr-0002-redis-job-queue|supersedes]]"
  - "[[tech/job-queue|related]]"
---
# ADR 3: Postgres-backed job queue

## Context

The Redis queue from [[tech/adr-0002-redis-job-queue]] lost jobs on failover and could not enqueue inside a database transaction.

## Decision

Store jobs in Postgres and claim them with `SKIP LOCKED`. A job is inserted in the same transaction as the change that needs it.

## Consequences

- No more lost jobs and one less system to operate.
- Throughput is bounded by the primary. At 40 jobs per second this is irrelevant, see [[tech/job-queue]].
- Delayed jobs are rows with a `run_at` column, which makes the dunning schedule easy to inspect with plain SQL.
