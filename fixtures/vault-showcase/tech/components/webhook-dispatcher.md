---
type: component
status: implemented
owner: karim
tags: [integrations]
paths:
  - services/webhooks/**
links:
  - "[[tech/webhooks|implements]]"
  - "[[tech/job-queue|depends_on]]"
---
# Webhook dispatcher

Reads events from the outbox, signs them and delivers them to customer endpoints with retries. See [[tech/webhooks]] for the contract.

## Retry schedule

Six attempts after the first failure, at 1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours and 24 hours. The endpoint is flagged unhealthy after the last attempt and the workspace admin is emailed.
