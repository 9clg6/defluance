---
type: note
status: approved
owner: ana
tags: [x]
---
# Rate limiting

The public API accepts one hundred calls per minute for each token. Above that, the server answers with HTTP status 429 and tells the client how long to wait.
