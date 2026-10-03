---
type: note
status: approved
owner: clement
tags: [meeting, finance]
links:
  - "[[tech/ledger|related]]"
  - "[[ops/runbook-ledger-reconciliation|related]]"
---
# Ledger review with finance, 15 September

Attendees: Clement, Lea, Karim, two people from finance. #meeting #finance

Finance walked through three months of PSP payout reports against our balances. Two differences, both explained by fees booked a day late.

## Decisions

- Book PSP fees on the payout date, not the capture date. Change tracked in [[tech/ledger]].
- Reconciliation runs daily at 06:00 UTC and pages if the difference is not zero, see [[ops/runbook-ledger-reconciliation]].
- Revisit multi-currency rounding once [[produit/multi-currency]] ships.
