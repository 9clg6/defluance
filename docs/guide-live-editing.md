---
type: note
status: approved
owner: clement
tags: [guide, editing]
links:
  - "[[guide-security|related]]"
  - "[[guide-deploy|related]]"
  - "[[guide-api|related]]"
---
# Editing a note together

Several people can open the same note in the editor and see each other type, with a coloured cursor and name for each. It works over WebSockets, in the same process and on the same port as the rest of Defluance: there is nothing else to install or configure.

## What is shared, and what is not

- **The text, live.** Everyone in the editor sees the same text. A header shows who is on the note (also for people only reading it).
- **Git stays the source of truth.** Nothing is committed until somebody presses **Save**. Saving goes through the normal path: schema check, audit log, conflict detection. After a save, the editor stays open and everyone's *Save* button goes quiet; the others are told who saved.
- **Unsaved text is kept.** The server keeps the shared text as a draft, so a restart or everyone closing their tab does not lose it. It is dropped when the text is back to what is committed.
- **Discard is for everyone.** *Discard changes* throws away the unsaved text for every person in the editor, after a confirmation.

## When someone changes the note elsewhere

If the note is committed from outside the editor (the API, an agent writing to main, `git pull`), the editor shows *saved from outside the editor*. Your text keeps its old base on purpose: saving then reports a conflict, with the usual choices (keep editing, load theirs, overwrite). An agent that writes to a branch does not touch the note on main.

## Who can do what

- A person who can read the note's space can open it and see who is there. A person who can write can change the text. Someone who cannot see the note gets a 404, as everywhere.
- Names and colours come from the server, not from the browser: nobody can sign as somebody else.
- A browser session must come from the page's own origin (or one listed in `DFL_ALLOWED_ORIGINS`): another site cannot use your cookie to join.
- Limits: 4 MB per message, 20 connections per person, 500 rooms.
- If WebSockets are blocked (a proxy that does not forward them), the editor falls back to the usual single-person draft after a few seconds.

## Behind a proxy

Forward the WebSocket upgrade for `/collab/*`. Caddy and recent nginx versions do so with a plain reverse proxy; for nginx add `proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`. Nothing to configure on a single instance. With several instances, send all connections for the same note to the same one (a room is held in one process), or use a single instance for editing.
