---
type: functional-spec
status: implemented
owner: lea
tags: [billing, invoices]
acceptance_criteria:
  - A credit note references exactly one issued invoice and cannot exceed its remaining balance
  - Credit notes have their own gapless number series
  - A credit note can be applied to the customer's balance or refunded to the original method
  - The monthly statement lists credit notes next to the invoices they correct
links:
  - "[[produit/invoice-lifecycle|depends_on]]"
  - "[[produit/refunds|related]]"
  - "[[tech/ledger|depends_on]]"
  - "[[gh:acme/app#72|tracked_by]]"
---
# Credit notes

A credit note reduces what a customer owes without touching the invoice. It is the only supported way to correct an issued invoice, see [[produit/invoice-lifecycle]].

## Behaviour

Creating a credit note posts the reverse entries in the ledger ([[tech/ledger]]). If it is refunded, the refund flow of [[produit/refunds]] runs next; otherwise the amount sits as a balance and is consumed by the next invoice.

Until October the monthly statement forgot credit notes issued in the same month, which confused two customers. That was fixed in [[gh:acme/app#72]].
