---
type: technical-spec
status: approved
owner: ana
tags: [integrations]
---
# Webhooks

Webhooks deliver events to a customer endpoint as signed JSON. Each request carries an HMAC SHA-256 signature header. Failed deliveries are retried six times with exponential backoff.
