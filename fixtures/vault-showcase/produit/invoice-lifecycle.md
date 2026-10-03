---
type: functional-spec
status: implemented
owner: lea
tags: [billing, invoices]
acceptance_criteria:
  - An invoice moves through draft, open, paid, void or uncollectible and no other path
  - Only draft invoices can be edited; issued invoices are corrected with a credit note
  - The invoice number is gapless per workspace and per year
  - Overdue is computed from the due date, never stored
links:
  - "[[produit/billing-invoices|depends_on]]"
  - "[[tech/components/billing-engine|implements]]"
  - "[[produit/credit-notes|related]]"
  - "[[tech/ledger|depends_on]]"
  - "[[gh:acme/app#34|tracked_by]]"
---
# Invoice lifecycle

An invoice is created as a **draft**, either by hand or by the monthly run described in [[produit/billing-invoices]]. Issuing it assigns the legal number, renders the PDF and moves it to **open**. From there it can be **paid**, **void** (cancelled before any payment) or **uncollectible** (written off after [[produit/dunning]] gives up).

## Numbering

Numbers look like `ACME-2026-000142`. Tax authorities in several of our markets require them to be gapless, so the sequence is allocated inside the same database transaction as the issue. A failed issue does not burn a number.

## Corrections

An issued invoice is immutable. To fix a mistake, issue a credit note ([[produit/credit-notes]]) and a new invoice. Refunds follow the same rule, see [[produit/refunds]].

Every state change posts a ledger entry, see [[tech/ledger]].
