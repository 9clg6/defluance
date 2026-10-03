---
type: functional-spec
status: approved
owner: priya
tags: [billing, collections]
acceptance_criteria:
  - Reminders go out at due date, +7, +14 and +30 days by default, and each schedule is editable per workspace
  - Dunning stops immediately when the invoice is paid, voided or disputed
  - After the last reminder the invoice is flagged uncollectible only by a person, never automatically
  - Customers can reply to a reminder and the reply reaches the billing contact
links:
  - "[[produit/invoice-lifecycle|depends_on]]"
  - "[[produit/payment-retries|related]]"
  - "[[produit/notifications|depends_on]]"
  - "[[tech/job-queue|depends_on]]"
  - "[[produit/meetings/2026-09-02-dunning-kickoff|related]]"
  - "[[gh:acme/app#58|tracked_by]]"
  - "[[gh:acme/app#61|tracked_by]]"
---
# Dunning

Dunning is how we nudge a customer to pay an overdue invoice without damaging the relationship. It combines email reminders with card retries (the retry rules live in [[produit/payment-retries]]).

## Default schedule

| Day | Action |
|-----|--------|
| 0 | Friendly reminder with the payment link |
| +7 | Second reminder, mentions the amount and due date |
| +14 | Firm reminder, copies the workspace owner |
| +30 | Final notice, invoice appears in the "at risk" list |

> [!warning] Never dun a disputed invoice
> If the cardholder opens a dispute, every pending reminder must be cancelled. Sending a reminder during a dispute has already cost us one customer.

## Scheduling

Reminders are jobs on [[tech/job-queue]], computed from the due date when the invoice is issued and recomputed if the due date changes. The workspace can change the offsets but not go below three days between messages.
