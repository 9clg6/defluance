# Cross-browser end-to-end tests

Tests for the web UI with [e2e](https://e2e.tester.army) (tester.army), run on four targets: Chromium, Firefox, WebKit and a phone-sized WebKit.

These flows are deterministic: locators and assertions, no model, no network beyond the local server. The Playwright suite in `apps/web/e2e` stays: it carries the axe accessibility checks and the CSP check. This one adds engines and flows.

```bash
pnpm build                                  # the server and the UI must be built
pnpm --filter @defluance/e2e test:e2e       # all targets
pnpm --filter @defluance/e2e exec e2e run --target chromium   # one target
pnpm --filter @defluance/e2e exec e2e run --last-failed       # after a red run
```

`scripts/serve.mjs` starts Defluance on a throwaway copy of `fixtures/vault-demo`, so each run begins from the same notes. All targets share that server, so a test that writes creates its own note (see `scratchNote` in `tests/editing.e2e.ts`) and never counts notes.

Telemetry is off in CI. Locally, `npx e2e telemetry disable` or `E2E_TELEMETRY_DISABLED=1`.

## What is covered

| File | Flows |
| --- | --- |
| `auth` | redirect to login, wrong token, right token, token in the address fragment |
| `reading` | home, typed links, diagram, broken link, unknown note, questions with sources and refusal |
| `search` | palette, type filter, search page and its address, no match |
| `editing` | save as a commit and see it in history, concurrent edit (409), wikilink and link-type completion, new note, status change |
| `graph-and-settings` | graph canvas and list, orphan report, tokens, members, GitHub tab, audit |
| `preferences` | theme and language persist, no horizontal scroll |

## Agent steps (not verified)

`tests/agent.e2e.ts` drives three flows from a goal in natural language. It needs a model, and nobody has run it with one yet: the deterministic suite is what CI trusts.

```bash
npx e2e login openai                       # a ChatGPT subscription, or
export AI_GATEWAY_API_KEY=...              # an AI Gateway key
export E2E_AGENT_MODEL=anthropic/claude-sonnet-5.5
pnpm --filter @defluance/e2e test:agent
```

## Things learned the hard way

- Text matching is exact and whole-string. Use `{ exact: false }` for a sentence that contains the words you look for.
- `selectOption('review')` selects by label. Use `{ value: 'review' }` for a value.
- `press` and `pressSequentially` click the editor first, which closes the completion list and moves the caret. Fill the document, then choose an option by clicking it.
- The engine cannot set the browser language yet and the app follows it. WebKit inherits the machine's. `openInEnglish` in `tests/support.ts` pins English through the app's own stored preference.
- After a client-side navigation the address has no trailing slash. Match it with a regular expression.
