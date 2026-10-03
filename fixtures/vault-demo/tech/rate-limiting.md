---
type: technical-spec
status: review
owner: karim
tags: [integrations, auth]
links:
  - "[[tech/webhooks|related]]"
---
# Rate limiting

The public API allows one hundred requests per minute per token. Beyond that limit the server answers with status 429 and a Retry-After header.
