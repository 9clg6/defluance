---
type: functional-spec
status: approved
owner: nadia
tags: [messaging]
acceptance_criteria:
  - Every customer-facing email has a plain-text part and an unsubscribe link, except legal documents
  - Billing contacts receive invoice, payment and dunning emails; other users do not
  - Emails are sent within one minute of the triggering event
  - A bounced address is flagged on the workspace within five minutes
links:
  - "[[tech/job-queue|depends_on]]"
  - "[[produit/invoice-lifecycle|related]]"
  - "[[tech/webhooks|related]]"
---
# Notifications

Acme Pay talks to people in two ways: email, and webhooks for systems ([[tech/webhooks]]). This spec covers email.

## Who gets what

| Event | Recipient |
|-------|-----------|
| Invoice issued | Customer billing contact |
| Payment received | Customer billing contact and workspace owner |
| Reminder | Customer billing contact, see [[produit/dunning]] |
| Payout sent | Workspace owner |

Emails are rendered from versioned templates and sent through the job queue ([[tech/job-queue]]), so a provider outage delays them instead of losing them.
