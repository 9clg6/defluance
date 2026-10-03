---
type: functional-spec
status: approved
owner: ana
tags: [auth]
---
# Password reset

A user who forgot the password requests a reset link by email. The link is valid for one hour and can be used once. After a reset, all active sessions are closed.
