---
type: functional-spec
status: approved
owner: priya
tags: [billing, international]
acceptance_criteria:
  - An invoice has exactly one currency, chosen at creation from the supported list
  - Amounts are stored as integers in minor units with the ISO 4217 exponent
  - The customer pays in the invoice currency; we never convert silently
  - Reports show each currency separately and a converted total using the daily rate
links:
  - "[[produit/invoice-lifecycle|related]]"
  - "[[tech/ledger|depends_on]]"
  - "[[produit/tax-handling|related]]"
  - "[[gh:acme/app#70|tracked_by]]"
---
# Multi-currency

We launch with EUR and USD and add GBP, CHF and JPY in the same release. A workspace has a default currency but each invoice can differ.

## Rules

- ==Never store money as a float.== Amounts are integers in minor units, and the currency carries its exponent (2 for EUR, 0 for JPY).
- No automatic conversion at payment time. Converting is the PSP's job when the customer pays in a different card currency, and we report both amounts.
- Reporting uses the rate published each morning by the central bank feed, stored with the report so numbers do not change later.

## Edge cases

JPY has no decimals, so the rounding of VAT (see [[produit/tax-handling]]) happens at the yen. A credit note must use the currency of its invoice, see [[produit/credit-notes]].
