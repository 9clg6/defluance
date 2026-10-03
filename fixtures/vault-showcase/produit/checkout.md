---
type: functional-spec
status: implemented
owner: nadia
tags: [payments, checkout, v1]
acceptance_criteria:
  - A customer can pay an invoice from a hosted page without creating an account
  - Cards, SEPA debit and bank transfer are offered according to the invoice currency
  - 3-D Secure challenges complete inside the page and never lose the payment intent
  - A successful payment marks the invoice paid within five seconds
links:
  - "[[tech/payment-service|depends_on]]"
  - "[[tech/components/checkout-ui|implements]]"
  - "[[produit/invoice-lifecycle|related]]"
  - "[[tech/test-plan-checkout|tested_by]]"
  - "[[gh:acme/app#41|tracked_by]]"
  - "[[gh:acme/app#23|tracked_by]]"
---
# Hosted checkout

Every invoice email links to a hosted page where the customer pays. No login: the link carries a signed, single-invoice token. The page shows the invoice, the amount due, and the payment methods that make sense for the currency (see [[produit/multi-currency]]).

## Flow

```mermaid
sequenceDiagram
  Customer->>Checkout: open invoice link
  Checkout->>PaymentService: create payment intent
  PaymentService->>PSP: authorize
  PSP-->>Customer: 3-D Secure challenge
  Customer->>PSP: confirm
  PSP-->>PaymentService: captured
  PaymentService-->>Checkout: paid
```

## Details

- The payment intent is created once per page load and reused on retry, see [[tech/idempotency]].
- If the customer closes the tab during 3-D Secure, the intent stays pending for 30 minutes. If it fails, [[produit/payment-retries]] takes over for subscriptions.
- A receipt is sent through [[produit/notifications]].

> [!note] Safari autofill
> Safari 17 filled the card number into the wrong field, which broke the form for a week. Fixed in [[gh:acme/app#23]].
