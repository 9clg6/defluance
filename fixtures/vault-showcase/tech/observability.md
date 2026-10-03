---
type: technical-spec
status: approved
owner: clement
tags: [platform, ops]
links:
  - "[[tech/payment-service|related]]"
  - "[[ops/runbook-webhook-backlog|related]]"
---
# Observability

Three signals: structured logs, metrics, traces. Every request carries a `request_id` that appears in all three and in the audit log.

![[attachments/payment-volume.png|480]]

*Payments per hour in September, the dip is the PSP timeout described in [[ops/incident-2026-08-psp-timeout]].*

## Service level objectives

- Payment confirm success rate: 99.5% over 30 days, excluding declines.
- Webhook first-attempt delivery under 60 s: 99%.
- Invoice PDF available within 30 s of issue: 99.9%.

## Alerts

Page only on symptoms the customer feels: confirm error rate above 2% for 5 minutes, queue age above 10 minutes, ledger imbalance greater than zero. Everything else is a ticket. #oncall
