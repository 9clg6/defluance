---
type: note
status: approved
owner: clement
tags: [runbook, finance]
links:
  - "[[tech/ledger|related]]"
  - "[[tech/components/ledger-service|related]]"
---
# Runbook: ledger reconciliation mismatch

**When:** the 06:00 UTC reconciliation reports a non-zero difference against the PSP payout report.

1. Open the reconciliation report and note the currency and the date range.
2. Check whether the PSP payout is still `in_transit`. Late settlements explain most differences and resolve themselves.
3. If not, list ledger entries for the range that have no PSP reference. They are candidates for a missed capture.
4. Never edit entries. Post a correcting entry through the ledger service and add the incident id in the memo, see [[tech/ledger]].
5. Tell finance in the #finance-ops channel before closing.

> [!danger] Do not run reconciliation fixes on a Friday evening without a second person
> A wrong correcting entry is itself a ledger entry that someone has to explain.
