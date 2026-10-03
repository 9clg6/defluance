---
type: note
status: approved
owner: clement
tags: [guide, agents]
links:
  - "[[guide-security|related]]"
  - "[[guide-getting-started|related]]"
---
# Agents and MCP

Defluance is a [Model Context Protocol](https://modelcontextprotocol.io) server. An agent such as Claude Code can search your specs, read them with their links, work out what a change touches, and propose drafts, all through the same permissions as a person.

## Connect Claude Code

In Settings, API tokens, create a token with the permissions the agent needs, then run the command shown:

```bash
claude mcp add --transport http defluance http://localhost:4000/mcp \
  --header "Authorization: Bearer dfl_..."
```

No server to run? Use the local stdio server, which reads the folder directly:

```bash
claude mcp add defluance -- npx defluance mcp ./my-notes
```

Over HTTP the token is the only credential: browser cookies are never accepted on `/mcp`.

## Tools

| Tool | Does |
|------|------|
| `search` | Hybrid keyword and semantic search. Best passage of each note |
| `read_note` | Frontmatter, Markdown, typed links, linked GitHub issues |
| `list_notes` | Notes by type, status, space, tag |
| `graph_neighbors` | Notes linked to a note, by direction, link type and depth |
| `graph_impact` | What depends on a note, implements it or tests it, and the GitHub issues tracking them |
| `create_draft` | A new note from the vault template |
| `update_note` | Replace a note. Pass `base_commit` to avoid overwriting someone's edit |
| `link_notes` | Add a typed link to a note or to `gh:owner/repo#12` |
| `create_issue` | Open a GitHub issue from a note and link it back |
| `ask` | A cited answer, or a refusal when nothing supports one |

## What agents can and cannot do

A caller is treated as an **agent** when it uses a token without the `admin` permission. Agents:

- **write to a branch** named `defluance/<token name>/<note>`, never to the main branch. A person reviews and merges. Change this per vault with `agent_write_mode: direct` in `.defluance/config.yaml`;
- **create drafts only** and cannot set a note to `approved` or `implemented`: a person approves;
- are **limited to the spaces** of their token, and notes outside them do not exist for them (no hint in search, links or the graph);
- are **audited**: every write records the token name, the tool and the commit.

Give each agent its own token, so the audit log tells them apart. See [[guide-security]].

## Example

> Using the defluance tools: find the specs about password reset, check what depends on the sessions spec, then draft a technical spec called "Token rotation" that depends on it.

The agent calls `search`, `graph_impact`, then `create_draft` and `link_notes`. The draft appears on a branch, and the Audit page lists the three writes.
