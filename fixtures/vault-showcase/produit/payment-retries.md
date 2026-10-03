---
type: functional-spec
status: review
owner: priya
tags: [payments, collections]
acceptance_criteria:
  - A soft decline is retried up to four times over twelve days
  - A hard decline (stolen card, closed account) is never retried
  - Each retry reuses the original payment intent and is idempotent
  - The customer is told what happened and how to update the card before the last retry
links:
  - "[[produit/dunning|related]]"
  - "[[tech/idempotency|depends_on]]"
  - "[[tech/psp-integration|depends_on]]"
  - "[[tech/job-queue|depends_on]]"
---
# Payment retries

About one in twelve subscription renewals is declined for a reason that fixes itself: insufficient funds that day, a bank timeout, an expired authorization. Retrying at the right moment recovers most of them.

## Rules

1. Classify the PSP decline code as **soft** or **hard** (mapping lives in [[tech/psp-integration]]).
2. Soft declines are retried on days 1, 3, 7 and 12, preferably on a weekday morning in the cardholder's timezone.
3. Hard declines move the invoice to dunning immediately, see [[produit/dunning]].

## Open points

- We want retry timing to depend on the decline code, but we do not have enough data yet. Priya is pulling two months of declines.
- Network tokens may remove half of the expired-card cases. Not in scope for this version.
