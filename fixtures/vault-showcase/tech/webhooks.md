---
type: technical-spec
status: implemented
owner: karim
tags: [integrations, platform]
links:
  - "[[tech/components/webhook-dispatcher|implements]]"
  - "[[tech/adr-0005-transactional-outbox|depends_on]]"
  - "[[gh:acme/app#52|tracked_by]]"
---
# Webhooks

Webhooks deliver events such as `invoice.paid` and `payment.failed` to a customer endpoint as signed JSON. Events are read from the outbox ([[tech/adr-0005-transactional-outbox]]) so a webhook is never sent for a change that was rolled back.

## Signing

Each request carries `Acme-Signature: t=<unix>,v1=<hmac>`, an HMAC SHA-256 of `t.body` with the endpoint secret. Receivers should reject timestamps older than five minutes.

## Delivery

Failed deliveries (non-2xx or timeout after 10 s) are retried six times with exponential backoff: 1 min, 5 min, 30 min, 2 h, 6 h, 24 h. After that the endpoint is flagged and the workspace admin gets an email. See [[ops/runbook-webhook-backlog]] when the queue grows. Rate limits that protect our side are in [[tech/rate-limiting]].
