---
type: technical-spec
status: approved
owner: ana
tags: [auth]
---
# Sessions

Sessions are signed JWT tokens stored in an HttpOnly cookie. Access tokens expire after fifteen minutes and are renewed with a refresh token valid for seven days.
