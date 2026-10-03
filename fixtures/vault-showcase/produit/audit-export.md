---
type: functional-spec
status: draft
owner: sam
tags: [compliance, enterprise]
acceptance_criteria:
  - An admin can export the audit log for a date range as CSV or JSON
  - Exports of more than 100000 rows run in the background and arrive by email as a link
  - The export itself is recorded in the audit log
links:
  - "[[produit/roles-permissions|depends_on]]"
  - "[[tech/audit-log-storage|depends_on]]"
  - "[[tech/data-retention|related]]"
  - "[[gh:acme/app#66|tracked_by]]"
---
# Audit log export

Auditors and security teams want the audit trail outside the product. This is the first step: a manual export, no streaming yet.

## Columns

Timestamp (UTC), actor, actor type (user, API token), action, target, IP address and request id. Personal data in the log follows the retention rules in [[tech/data-retention]].

## Questions

- Do we need signed exports so an auditor can prove nothing was removed?
- Where do the files live? The storage design is not written yet, which is why the link to the audit log storage spec is still empty.
