---
type: note
status: approved
owner: sam
tags: [runbook, integrations]
links:
  - "[[tech/webhooks|related]]"
  - "[[tech/job-queue|related]]"
---
# Runbook: webhook backlog

**When:** the alert "webhook queue age above 10 minutes" fires.

1. Check the dashboard: is one endpoint failing, or is every delivery slow?
2. One endpoint failing: it is probably down on the customer side. Do nothing, the backoff protects us.
3. Everything slow: check worker saturation and PSP status. Scale workers to eight if saturated.
4. Confirm the retry behaviour below before promising anything to a customer.

![[tech/components/webhook-dispatcher#Retry schedule]]

Contract and signing details are in [[tech/webhooks]].
