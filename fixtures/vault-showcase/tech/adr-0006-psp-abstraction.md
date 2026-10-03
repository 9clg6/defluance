---
type: adr
status: review
owner: sam
tags: [payments, integrations]
links:
  - "[[tech/psp-integration|related]]"
  - "[[tech/payment-service|related]]"
---
# ADR 6: One internal interface for every PSP

## Context

Sales wants to offer local payment methods that our current PSP does not support. Calling a second provider directly from the payment service would duplicate retries, webhooks and reconciliation.

## Decision

Define a small interface and one adapter per provider ([[tech/psp-integration]]). The payment service knows nothing PSP-specific.

## Consequences

We lose access to provider-only features unless the interface grows to include them. We accept that: portability is worth more than the last 5% of features. Open question: do we route by currency or by cost?
