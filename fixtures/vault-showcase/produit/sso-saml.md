---
type: functional-spec
status: review
owner: nadia
tags: [auth, enterprise]
acceptance_criteria:
  - A workspace admin can configure a SAML 2.0 identity provider with metadata XML or URL
  - Users with a verified email domain are required to sign in through SSO
  - The first SSO login creates the user with the role set in the domain rule
  - Password login stays available for a break-glass admin
links:
  - "[[produit/auth-login|related]]"
  - "[[produit/roles-permissions|depends_on]]"
  - "[[tech/sessions|depends_on]]"
  - "[[tech/auth-module|related]]"
  - "[[gh:acme/app#63|tracked_by]]"
---
# SAML single sign-on

Enterprise customers ask for SSO in every security review. This spec covers SAML 2.0 only; OIDC is a follow-up.

## Behaviour

An admin adds an identity provider under Settings, Security, then proves ownership of one or more email domains with a DNS TXT record. From then on, anyone with an address on those domains is redirected to the provider and cannot use a password.

Sessions created by SSO use the same signed tokens as [[produit/auth-login]], with a shorter refresh window (see [[tech/sessions]]). Roles come from the domain rule or default to viewer, see [[produit/roles-permissions]].

## Out of scope

SCIM provisioning, per-group role mapping, and IdP-initiated login.
