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

### Link a repository

You do not have to edit the file by hand. In Settings, GitHub, **Repositories the App can see** lists every repository the App is installed on. Pick a space (or "No space" for the default `repos`) and press **Link**: Defluance adds the repository to `.defluance/config.yaml`, keeping your comments and layout, commits it as `github: link acme/app`, and syncs its issues and pull requests in the background. **Unlink** does the reverse. Only an admin of every space can do it, and agents cannot.

The same from the API, with an admin token:

```bash
curl -X PUT $URL/api/v1/github/repos -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"repo": "acme/app", "space": "product", "linked": true}'
```

`space` is optional. The repository must be one the App can see (422 otherwise), and the answer is 503 when GitHub is not configured. People only see the issues and pull requests of repositories linked to spaces they can read.

### Link a public repository without installing the App

When you cannot install the App on a repository (it belongs to an organisation you do not own), you can still read its issues and pull requests if it is public. Link it with `public: true`:

```bash
curl -X PUT $URL/api/v1/github/repos -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"repo": "linagora/twake-on-matrix", "space": "product", "linked": true, "public": true}'
```

The server asks GitHub's public API, with no credentials at all, whether the repository exists and is public (422 if it is missing or private, 503 with the reset time if GitHub is rate-limiting the server). It then links it like any other repository (commit `github: link linagora/twake-on-matrix (public)`) and syncs it. The answer carries `public: true`. The App must still be configured on the server (503 otherwise), but it does not need to be installed on that repository. If the App can see the repository, the installed path is used and `public` is `false`.

What to expect:

- **Read-only.** You can read, search and mention its issues and pull requests, but not open issues, open pull requests or comment on it.
- **60 requests per hour.** GitHub gives anonymous callers 60 requests per hour per IP address, shared by every public repository. A sync pages through 100 items at a time, keeps 5 requests in reserve, and when the budget is spent it stops, keeps what it fetched, and continues after GitHub's reset time. The first sync reads at most the 300 most recent issues and the 300 most recent pull requests.
- **Refreshed every 15 minutes.** There are no webhooks for these repositories, so the server re-reads each linked public repository, one at a time, every 15 minutes while it runs, and at startup. **Resync now** does the same.
- **No file-based impact analysis.** Reading the files of a pull request costs one request each, so public repositories have none: "specs touched by this pull request" does not work for them.

People only see these items in spaces they can read, exactly like installed repositories. `GET /api/v1/github/status` lists them in `publicRepos`, with the last sync of each in `publicSync` (`partial`, `rateLimitedUntil`). To stop, **Unlink** the repository (or `linked: false` with the same request): it leaves the configuration and the 15 minute refresh.

## Linking

In a note, write `[[gh:acme/app#12|tracked_by]]` (or use Open GitHub issue). To tie a pull request to a component, list the paths it owns:

```yaml
type: component
paths:
  - src/auth/**
```

`*` matches inside a folder, `**` across folders, and a path with no wildcard is a prefix.

## Mention issues and pull requests

While you edit a note, type `@` at the start of a line or after a space. A list of issues and pull requests appears, newest first, each as `#12 Title` with its kind, state and repository (`PR · open · acme/app`).

- `@` alone, or `@login`: search everything. `@12` or `@#12` finds that number first.
- `@pr login`: pull requests only. `@issue login`: issues only. The keyword is not case sensitive; after it, a space and the words to search for.
- Choose one with Enter. It writes `[[gh:acme/app#12]]`, a link with no type. To type it, step back inside the brackets and add a bar: `[[gh:acme/app#12|tracked_by]]` offers the link types, as for notes.

An address such as `ana@acme.io` does not open the list. Nothing is asked of the server when GitHub is not configured. The list comes from `GET /api/v1/github/items?q=&repo=&kind=issue|pull-request&state=open|closed|merged&limit=20` (at most 100), which any signed-in reader can call.

In the note, a link to an issue or pull request shows as a chip with the number, the title and a state dot (open, closed, merged), and opens GitHub in a new tab. One that was never synced says "not synced".

Agents do the same with the `search_github` tool, then `link_notes`, see [[guide-mcp]].

## Sync

Webhooks keep the cache current within seconds. If the server was down, run `defluance resync-github ./my-notes` or **Resync now** in Settings: it re-reads issues and pull requests changed since the last sync.

## Sign in with GitHub

Optional. Create an OAuth App with callback `<your address>/auth/github/callback` and set `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET`. People then sign in with GitHub. Nobody sees anything until an admin gives them a role (Settings, Members) or `DFL_DEFAULT_ROLE=reader` is set. `DFL_ADMINS=login1,login2` makes those people admins of every space.
