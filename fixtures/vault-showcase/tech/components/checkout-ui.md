---
type: component
status: implemented
owner: nadia
tags: [checkout, frontend]
paths:
  - apps/checkout/**
links:
  - "[[produit/checkout|implements]]"
  - "[[tech/payment-service|depends_on]]"
---
# Checkout UI

The hosted payment page, a small app in `apps/checkout/` that talks only to the payment service. It must work without any session cookie and stay under 150 kB of JavaScript. Behaviour is specified in [[produit/checkout]].
