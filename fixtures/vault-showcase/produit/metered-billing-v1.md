---
type: functional-spec
status: deprecated
owner: priya
tags: [billing, pricing]
acceptance_criteria:
  - Monthly counters are summed and added to the next invoice
links:
  - "[[produit/invoice-lifecycle|related]]"
---
# Metered billing (v1)

Deprecated: replaced by [[produit/usage-based-billing]] after the March pilot showed it double-counted events when a client retried.

The original design added a monthly counter per customer to the next invoice. It had no notion of late events, tiers or corrections. Kept for history, do not build on it.
