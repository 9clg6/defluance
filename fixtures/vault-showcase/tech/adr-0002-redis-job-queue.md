---
type: adr
status: deprecated
owner: sam
tags: [platform, queue]
links:
  - "[[tech/adr-0003-postgres-job-queue|related]]"
---
# ADR 2: Redis for background jobs

## Status

Deprecated, superseded by [[tech/adr-0003-postgres-job-queue]].

## Context

We needed delayed jobs and retries quickly, and BullMQ on Redis was the fastest way to get them.

## Decision

Run jobs on a managed Redis instance.

## Consequences

Jobs were lost twice when Redis failed over, because a job and its database change could not be committed together. That is the reason it was replaced.
