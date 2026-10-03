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

## Layout of a note

Under the title, a row of chips holds what used to be the Actions column: the status (a small menu), Rename or move, Delete, Encrypt this note, Open GitHub issue (each appears under the same conditions as before), then **Links (n)** and **Properties**. Links opens a panel with "Links from this note" (and its Add link button) and "Linked from"; Properties opens the note's frontmatter. Escape closes a panel and puts the focus back on its chip. Below 640px the chips keep only their icon (the names stay for screen readers) and wrap onto several lines.

- **Read tab**: the text has a comfortable column (about 52rem).
- **Edit tab**: the editor takes the full width of the page (the page is wider for notes), with no column on its right.

### Saving and generating

Save, the button that drops unsaved changes and "Generate with AI" sit at the right end of the editor's toolbar, so there is one bar above the text. The status shows once, in the control that changes it; while you edit, the properties are the "Properties" line at the top of the editor.

A note created with a description ("Describe what it should cover" in the New note dialog) gets its first draft at once: the language model writes into the editor and a banner says which model wrote it and what it was based on. Nothing is saved until you save, and "Remove the generated text" takes it out again. "Generate with AI" on an existing draft still shows a diff to review first, because there the text you already wrote matters.

### Preview

The "Preview" button at the right end of the toolbar (pressed while the preview is shown) puts the rendered note beside the editor. It is off by default, and on by default when "Markdown source" is on, since raw Markdown is easier to write with the result in view. Once you press it, your choice is remembered in this browser.

A divider sits between the editor and the preview. Drag it, or focus it and use Left and Right (2% per press), Home and End (the smallest and the largest editor); double-click puts it back at 50%. Each side keeps at least 25%, and the width is remembered in this browser. Below 900px the preview goes under the editor and there is no divider. Showing, hiding or resizing the preview never reloads the editor: live editing with others goes on.

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
