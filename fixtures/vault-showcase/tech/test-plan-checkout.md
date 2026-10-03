---
type: note
status: approved
owner: sam
tags: [testing, checkout]
links:
  - "[[produit/checkout|related]]"
  - "[[tech/payment-service|related]]"
---
# Test plan: checkout

What we run before shipping a change to checkout or the payment service.

## Automated

- PSP sandbox suite: success, soft decline, hard decline, 3-D Secure pass and fail, timeout.
- Contract tests for each adapter in [[tech/psp-integration]].
- Property test on the ledger: random event sequences always balance, see [[tech/ledger]].
- Browser tests on Chrome, Firefox and Safari for the hosted page, including autofill.

## Manual before a release

1. Pay an invoice with a 3-D Secure card from a phone.
2. Close the tab mid-challenge and reopen the link.
3. Refund the payment and check the invoice, the ledger and the email.
