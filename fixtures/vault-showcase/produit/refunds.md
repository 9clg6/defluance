---
type: functional-spec
status: approved
owner: lea
tags: [billing, payments]
acceptance_criteria:
  - A refund can be issued within 14 days of capture, or later with an admin override
  - Partial refunds are allowed, and the sum of refunds never exceeds the captured amount
  - The customer receives an email when the refund is issued, and the invoice shows it
  - The money returns to the original payment method; support cannot pick another destination
links:
  - "[[produit/billing-invoices|depends_on]]"
  - "[[produit/credit-notes|related]]"
  - "[[tech/ledger|depends_on]]"
  - "[[produit/tax-handling|depends_on]]"
---
# Refunds

A refund returns money for a payment that was already captured. Support issues it from the invoice page; the money goes back to the original payment method within five business days (the PSP controls the exact timing).

## Rules

- Window: 14 days after capture. After that an admin has to confirm, and the audit log records who did.
- Partial refunds are allowed. The ledger posts one entry per refund, see [[tech/ledger]].
- Each refund produces a credit note ([[produit/credit-notes]]), so the issued invoice is never edited.
- VAT is refunded proportionally, using the rate that applied on the invoice date. See [[produit/tax-handling]].

> [!warning] Chargebacks are not refunds
> A dispute opened by the cardholder is a separate flow owned by support and is out of scope here. Never refund a payment that is already disputed, the money would leave twice.

## Open questions

==Do we allow refunds on bank transfers?== Today the answer is no, because we cannot reach the sender's account. Decision pending with finance.
