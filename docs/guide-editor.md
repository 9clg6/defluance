---
type: note
status: approved
owner: clement
tags: [guide, editing]
links:
  - "[[guide-live-editing|related]]"
  - "[[guide-github|related]]"
  - "[[vault-format|related]]"
---
# The editor

You do not need to know Markdown to write a note. The editor looks like a classic text editor with a formatting toolbar. What is stored is still plain Markdown: the vault stays readable in git, and everything you do in the toolbar is an ordinary edit of that text.

## Live preview

Text is shown as it will look: headings are big, **bold** is bold, a list dash is a bullet, a task is a checkbox you can click, a link shows its text. The Markdown marks (`#`, `**`, backticks, link brackets, `>`) are hidden, except on the line your cursor is on. There the raw Markdown is shown so you can edit it normally. Move the cursor away and it is hidden again.

- Links: hold Cmd (Mac) or Ctrl and click a link to open it. `[[note]]` links open the note, `[[gh:owner/repo#12]]` opens the issue on GitHub.
- `[[note|type]]` shows only the note; a GitHub reference shows as a small chip with its number.
- Code blocks, quotes, tables and horizontal rules are styled. Callouts (`> [!warning] Title`) keep the coloured edge they have in the rendered note.
- Images (`![[x.png]]`) stay as text, styled.
- The cursor skips hidden marks as one step, and live preview never changes the text: what is shared with the others and what is saved are byte for byte what was typed.

### Properties

The YAML block at the top of the note (type, status, owner...) is folded into one line, "Properties (3)". Click it, or move the cursor into it, to see and edit the raw YAML. It folds again when the cursor leaves.

### Markdown source

The "Markdown source" button at the right end of the toolbar turns live preview off, for people who prefer to see the raw Markdown. It is remembered in this browser. Live preview is on by default.

## Toolbar

Every button has a name for screen readers and a tooltip (on hover and on keyboard focus). A button is pressed while the cursor is in that format. The toolbar wraps on small screens.

| Button | What it does |
| --- | --- |
| Heading | Paragraph, Title 1, 2 or 3 for the selected lines. |
| Bold, Italic, Strikethrough, Inline code | Wrap the selection. On text that already has the format, they remove it. With nothing selected they insert a placeholder, selected, to overwrite. |
| Bulleted list, Numbered list, Checklist, Quote | Per selected line. Switch from one list kind to another, or press again to take it off. |
| Code block | Fences the selected lines, or removes the fence when the cursor is in a block. |
| Link | A small panel asks for the web address and wraps the selection (or inserts the text). |
| Note link | Pick a note, optionally a link type, and `[[note]]` or `[[note|type]]` is inserted. |
| GitHub issue or pull request | Types `@` and opens the mention list. |
| Image or file | Uploads a picture or PDF to the vault and inserts `![[attachments/...]]`. |
| Table | A table of 3 columns with a header and two empty rows. |
| Horizontal rule | A line across the page. |
| Callout | Note, tip, warning, danger or question: `> [!type] Title`. |
| Undo, Redo | With live editing, they only undo your own changes. |

### Shortcuts

| Shortcut | Action |
| --- | --- |
| Mod-B, Mod-I | Bold, italic |
| Mod-Shift-X | Strikethrough |
| Mod-E | Inline code |
| Mod-K | Link |
| Mod-Alt-1, 2, 3 | Title 1, 2, 3 (press again for a paragraph) |
| Mod-Shift-7, 8, 9 | Numbered list, bulleted list, checklist |
| Mod-S | Save |
| Mod-Z, Mod-Shift-Z | Undo, redo |

Mod is Cmd on a Mac and Ctrl elsewhere. Writing the Markdown by hand works too: the toolbar and the shortcuts only add or remove the same characters.

## Mentions and links

Under the editor: "Type @ to mention an issue or pull request, [[ to link a note."

- `[[` suggests notes; after a `|` it suggests link types.
- `@` suggests GitHub issues and pull requests (`@pr`, `@issue`, words or a number) and inserts `[[gh:owner/repo#12]]`. When nothing can be suggested the list says why: GitHub is not connected, no repository is linked yet (an admin gets a shortcut to Settings > GitHub), or no issue or pull request matches.

Public repositories can be linked in Settings > GitHub without installing the GitHub App (a form takes owner/name or a pasted GitHub address; the repository is read-only).
