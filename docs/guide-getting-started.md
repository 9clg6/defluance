---
type: note
status: approved
owner: clement
tags: [guide]
links:
  - "[[vault-format|related]]"
  - "[[guide-mcp|related]]"
  - "[[guide-github|related]]"
  - "[[guide-deploy|related]]"
---
# Getting started

## Requirements

Node.js 22.13 or later (Defluance uses the SQLite built into Node) and git. Nothing else: no database server, no model download.

## Start on a folder

Any folder of `.md` files works, including an existing Obsidian vault.

```bash
npx defluance serve ./my-notes
```

The first start prints an admin token once and a sign-in link:

```text
Sign in: http://127.0.0.1:4000/login#token=dfl_...
```

Create more tokens later with `defluance token create <name> --scopes read,write`. Lost the first one? Create another from the terminal, it needs access to the same folder.

The vault becomes a git repository if it is not one yet. Every save from the interface or the API is a commit made as the person who saved.

## Write notes

A note is a Markdown file with a short header. See [[vault-format]] for the full rules.

```markdown
---
type: functional-spec
status: draft
owner: nadia
acceptance_criteria:
  - The reset link works once
links:
  - "[[tech/sessions|depends_on]]"
---
# Password reset

Users get a link by email. See [[tech/sessions]] for how sessions end.
```

- Create from a template: `defluance new functional-spec "Title"`, or **New note** in the interface.
- Link while typing: in the editor, `[[` suggests notes and `|` suggests link types.
- Types, statuses and link types are the defaults of `.defluance/schema.yaml`, created by `defluance init`. Edit it to add your own.

## Check the vault

```bash
defluance validate ./my-notes
```

It reports missing fields, unknown types and statuses, broken links, and notes nobody links to. Errors give exit code 1. In GitHub Actions:

```yaml
- run: npx defluance validate docs
```

## Search and ask

- `Ctrl+K` (`Cmd+K` on Mac) searches every note. Filter by type or status.
- The home page and each note's **Ask** tab answer questions in plain language and always list their sources. On a note, only that note and the notes linked to it are used.
- Search works offline with `DFL_EMBED=hash`, which matches shared vocabulary. For search by meaning, run a local model with Ollama (`DFL_EMBED=ollama:nomic-embed-text`) or use `openai:text-embedding-3-small`. Changing the model re-embeds the vault.

## Next

- Let an agent read and draft: [[guide-mcp]]
- Link specs to issues and pull requests: [[guide-github]]
- Run it for a team: [[guide-deploy]]
