---
type: adr
status: approved
owner: clement
tags: [core, finance]
links:
  - "[[tech/ledger|related]]"
---
# ADR 4: Double-entry, append-only ledger

## Context

Early versions kept a `balance` column per customer and updated it. Two bugs produced balances nobody could explain, and finance could not audit them.

## Decision

Record money as balanced debit and credit entries in an append-only table. Balances are derived by summing entries, never stored as the source of truth.

## Consequences

Any number can be traced to the events that produced it. Corrections are new entries. Reads are slower, so we keep a periodically refreshed balance snapshot as a cache only. See [[tech/ledger]] for accounts and rules.
