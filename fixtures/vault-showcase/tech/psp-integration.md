---
type: technical-spec
status: approved
owner: sam
tags: [payments, integrations]
links:
  - "[[tech/adr-0006-psp-abstraction|implements]]"
  - "[[tech/payment-service|related]]"
  - "[[produit/payment-retries|related]]"
---
# PSP integration

The payment service speaks to a single internal interface; one adapter per PSP translates it. Following [[tech/adr-0006-psp-abstraction]], adding a provider means writing an adapter and a test suite, not touching the service.

## Interface

`authorize`, `capture`, `refund`, `fetchPayout`, `parseWebhook`. All amounts are minor units, all calls take an idempotency key.

## Decline mapping

PSPs return hundreds of decline codes. The adapter maps each to `soft`, `hard` or `fraud`, which [[produit/payment-retries]] uses to decide what to do. Unknown codes default to `soft` once, then are reviewed weekly.

## Webhooks from the PSP

Signatures are verified in the adapter, events are stored raw, then processed through the queue so a slow handler never makes the PSP retry.
