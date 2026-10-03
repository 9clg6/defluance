---
type: note
status: approved
owner: nadia
tags: [start]
links:
  - "[[produit/checkout|related]]"
  - "[[tech/payment-service|related]]"
  - "[[tech/glossary|related]]"
  - "[[ops/runbook-ledger-reconciliation|related]]"
---
# Acme Pay workspace

Acme Pay is invoicing and payments for B2B teams: send an invoice, get paid by card or bank transfer, reconcile it in the ledger. This vault is the single source of truth for what we build and why. Product writes the specs, engineering answers with technical specs and decisions, and the on-call rota keeps the runbooks honest.

| Area | Where | Start with |
|------|-------|------------|
| Product specs | `produit/` | [[produit/checkout]], [[produit/invoice-lifecycle]] |
| Technical specs, components, ADRs | `tech/` | [[tech/payment-service]], [[tech/ledger]] |
| Runbooks and incidents | `ops/` | [[ops/runbook-ledger-reconciliation]] |

> [!tip] How we work
> A spec moves `draft` -> `review` -> `approved` -> `implemented`. Anything merged in `acme/app` that touches a component's `paths` is linked to that component automatically, so a spec tells you which pull requests built it.

Agents can propose changes, but they only ever write drafts on a branch. A person reads the diff and merges. If you are new, read [[tech/glossary]] first, then the decision records from [[tech/adr-0001-jwt-sessions]] onwards.
