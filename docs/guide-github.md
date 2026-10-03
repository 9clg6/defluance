---
type: note
status: approved
owner: clement
tags: [guide, github]
links:
  - "[[guide-deploy|related]]"
  - "[[guide-security|related]]"
---
# GitHub connector

With the connector, GitHub issues and pull requests become nodes of the graph.

- Open an issue from a spec. The note links to it as `tracked_by` and shows its state.
- A merged pull request moves the specs it tracks from `approved` to `implemented`, with a commit by `defluance-bot`.
- For any pull request, see the specs it touches: those linked to it, and components whose `paths` match the files it changes.
- Optionally, Defluance comments that list on the pull request.

Settings, GitHub in the app has the same steps with live status.

## 1. Create a GitHub App

Create it at github.com/settings/apps/new, or under your organisation.

- **Webhook URL**: `<your address>/webhooks/github`. Pick a secret.
- **Permissions**: Issues (read and write), Pull requests (read and write), Metadata (read). Add Contents (read and write) if the vault lives in a repository.
- **Events**: Issues, Pull request, Push, Installation.
- Generate a private key.

## 2. Give the server its credentials

```bash
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=the-secret-you-picked
```

Restart. Settings, GitHub shows **Connected** and the repositories the App can see. Webhooks are verified with an HMAC of the raw body and rejected otherwise.

## 3. Install it and map repositories to spaces

Install the App on the repositories your specs relate to. Then say which repository each space uses, in `.defluance/config.yaml` of the vault:

```yaml
spaces:
  - { name: product, path: product, repos: [acme/app] }
  - { name: platform, path: platform, repos: [acme/infra] }
repos: [acme/app]          # for notes outside any space
derive_status: true        # merged PR: approved -> implemented (default)
pr_comments: false         # comment on pull requests with the specs they touch
vault_repo: acme/specs     # a push to this repository makes the server pull and re-index
vault_push: false          # push every commit made by the server to origin
```

Issues can only be opened in the repositories of the note's space.

## Linking

In a note, write `[[gh:acme/app#12|tracked_by]]` (or use Open GitHub issue). To tie a pull request to a component, list the paths it owns:

```yaml
type: component
paths:
  - src/auth/**
```

`*` matches inside a folder, `**` across folders, and a path with no wildcard is a prefix.

## Sync

Webhooks keep the cache current within seconds. If the server was down, run `defluance resync-github ./my-notes` or **Resync now** in Settings: it re-reads issues and pull requests changed since the last sync.

## Sign in with GitHub

Optional. Create an OAuth App with callback `<your address>/auth/github/callback` and set `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET`. People then sign in with GitHub. Nobody sees anything until an admin gives them a role (Settings, Members) or `DFL_DEFAULT_ROLE=reader` is set. `DFL_ADMINS=login1,login2` makes those people admins of every space.
