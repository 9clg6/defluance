---
type: functional-spec
status: review
owner: lea
tags: [billing, compliance]
acceptance_criteria:
  - VAT is computed per line from the customer's country and the product tax category
  - A valid EU VAT number turns the sale into a reverse-charge sale with zero VAT
  - The rate applied is stored on the invoice line and never recomputed later
  - Invoices show the legal mentions required in the seller's country
links:
  - "[[produit/invoice-lifecycle|related]]"
  - "[[produit/multi-currency|related]]"
  - "[[gh:acme/app#75|tracked_by]]"
---
# Tax handling

Taxes are the part of invoicing where a mistake is expensive. This spec limits scope to VAT and similar sales taxes for EU, UK and Switzerland. US sales tax is a separate project.

## Calculation

1. Determine the place of supply from the customer's billing country.
2. Look up the rate for the country and the product's tax category.
3. If the customer gave a VAT number, validate it against VIES and apply reverse charge for cross-border B2B.

The rate is copied onto each invoice line when the invoice is issued, so later rate changes never alter history ([[produit/invoice-lifecycle]]). Refunds reuse that stored rate, see [[produit/refunds]].

## Risks

VIES is down a few hours a month. We accept the invoice and re-validate in the background rather than block payment.
