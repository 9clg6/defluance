---
type: technical-spec
status: approved
owner: ana
tags: [integrations]
---
# Rate limiting

The public API allows one hundred requests per minute per token. Beyond that limit the server answers with status 429 and a Retry-After header.
