---
type: functional-spec
status: review
owner: priya
tags: [billing, pricing]
acceptance_criteria:
  - Usage events are accepted idempotently with a customer-supplied key
  - A meter can aggregate by sum, max or unique count over the billing period
  - Late events up to 48 hours after period end are included in the invoice
  - Customers can see their current usage in near real time
links:
  - "[[produit/metered-billing-v1|supersedes]]"
  - "[[produit/invoice-lifecycle|depends_on]]"
  - "[[tech/idempotency|depends_on]]"
  - "[[tech/job-queue|related]]"
---
# Usage-based billing

Customers want to be billed for what they consume: API calls, seats, processed volume. The first attempt, [[produit/metered-billing-v1]], summed counters once a month and could not handle late or duplicate events. This version replaces it.

## Model

A **meter** defines how events are aggregated. A **price** attaches a meter to a unit price or a tiered table. At period end the billing engine reads the aggregate and creates invoice lines.

Events carry an idempotency key chosen by the sender, see [[tech/idempotency]]. Aggregation runs on the job queue ([[tech/job-queue]]) every five minutes for the live usage view.
