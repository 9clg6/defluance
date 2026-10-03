---
type: component
status: implemented
owner: clement
tags: [core, finance]
paths:
  - services/ledger/**
links:
  - "[[tech/ledger|implements]]"
  - "[[tech/adr-0004-double-entry-ledger|depends_on]]"
---
# Ledger service

Posts and reads ledger entries, enforces the balance constraint and exposes the reconciliation queries used by [[ops/runbook-ledger-reconciliation]]. Specified in [[tech/ledger]].
