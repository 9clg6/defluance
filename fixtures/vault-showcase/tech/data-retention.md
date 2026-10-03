---
type: technical-spec
status: approved
owner: sam
tags: [compliance, platform]
links:
  - "[[produit/audit-export|related]]"
  - "[[tech/ledger|related]]"
---
# Data retention

What we keep, and for how long. Legal minimums win over deletion requests; everything else is removed on schedule.

| Data | Retention | Reason |
|------|-----------|--------|
| Invoices, credit notes, ledger entries | 10 years | Accounting law in our main markets |
| Payment intents and PSP payloads | 24 months | Dispute window plus margin |
| Audit log | 13 months online, then archived 5 years | Security reviews |
| Webhook delivery logs | 30 days | Debugging only |
| Application logs | 14 days | Debugging only |

## Erasure requests

A customer contact can be anonymised: name and email are replaced by a hash, invoices stay because the law requires it. The job runs nightly and is logged. Card data never reaches our servers, the PSP holds it.
