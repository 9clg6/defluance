---
type: technical-spec
status: implemented
owner: clement
tags: [core, finance]
links:
  - "[[tech/components/ledger-service|implements]]"
  - "[[tech/adr-0004-double-entry-ledger|depends_on]]"
  - "[[tech/test-plan-checkout|tested_by]]"
  - "[[gh:acme/app#47|tracked_by]]"
---
# Ledger

The ledger is the book of record for money. It follows [[tech/adr-0004-double-entry-ledger]]: every business event posts a balanced set of entries, and entries are never updated or deleted.

## Accounts

`customer_receivable`, `cash_psp`, `revenue`, `vat_payable`, `refunds`, `fees_psp`, `writeoffs`. One set per workspace and currency.

## Posting rules

| Event | Debit | Credit |
|-------|-------|--------|
| Invoice issued | customer_receivable | revenue, vat_payable |
| Payment captured | cash_psp | customer_receivable |
| Refund issued | refunds, vat_payable | cash_psp |
| Write-off | writeoffs | customer_receivable |

==The sum of debits equals the sum of credits for every posting group, enforced by a deferred database constraint.== A posting that does not balance rolls back the whole transaction.

## Corrections

To fix a wrong posting, post the reverse and then the right one. The daily reconciliation compares our balances with the PSP payout reports, see [[ops/runbook-ledger-reconciliation]].
