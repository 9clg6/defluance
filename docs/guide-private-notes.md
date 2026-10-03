---
type: note
status: approved
owner: clement
tags: [guide, security, encryption]
links:
  - "[[guide-security|related]]"
  - "[[guide-mcp|related]]"
  - "[[vault-format|related]]"
---
# Private notes

A private note is encrypted. Only the people you choose can read it. Nothing readable about it is stored on disk, in git, in the search index, in the database, in logs or in the audit log, and a language model never sees its text unless the operator allows it.

## How it works

- Each note gets its own random key (AES-256-GCM). That key is wrapped for every recipient with their RSA key (RSA-OAEP, SHA-256). The file keeps `type`, `status` and `owner` in clear, so the vault can still be validated and listed; they are bound to the ciphertext, so editing them without a key breaks it. The title, the links, the tags and the text exist only in the ciphertext.
- A **key** is an RSA pair (4096 bits by default). The public half is committed to the vault keyring (`.defluance/keys/`), so people can encrypt for you. The private half is stored only as a blob protected by your passphrase (scrypt, then AES-256-GCM), in the server database. The passphrase is never stored.
- To read private notes you **unlock** a key with its passphrase. The server then holds the key in memory for you: it locks itself after 30 minutes without use, and after 8 hours whatever happens. Five wrong passphrases lock the key out for 15 minutes. Locking, revoking a token or restarting the server drops it.
- While a key is unlocked, the notes it can open are decrypted into memory (never to disk) and searched by words together with the rest of the vault. When the key locks, that plaintext is dropped.

## Using it

**In the web UI.** Settings, *Private notes*: create a key (the passphrase must be at least 10 characters, and cannot be recovered: download a backup). Tick *Private note* when you create a note, or use *Encrypt this note* on an existing one. A locked note shows a form to unlock your key. *Who can read it* lists the recipients; add a person from the keyring, or remove one.

**From the command line**, with a key that never leaves your machine:

```bash
defluance keys generate --label "My key"      # private key in ~/.defluance/keys, public key in the vault keyring
defluance encrypt specs/acquisition --to <fingerprint>
defluance decrypt specs/acquisition            # prints the text; --write puts it back in place
defluance share specs/acquisition --to <fingerprint>
defluance unshare specs/acquisition --from <fingerprint>
```

**For an agent.** Create its token with a key of its own (*Give this token a key of its own*, or `private_key: true` in the API). The key is protected by the token itself: an agent that sends its token can read the private notes shared with its key, and only those. Give the agent's fingerprint as a recipient (`recipients` when creating a note, or *Who can read it*). An agent that creates a private note (`create_draft` with `private: true`) writes to a branch like any agent.

## What you should know

| Question | Answer |
|----------|--------|
| Is the file name secret? | No. The note's id (its path), type, status, owner and recipients are visible, in git too. |
| I encrypted a note that was plain. | Earlier versions stay readable in git history, and may remain in database pages. Encrypting does not rewrite history. Treat the old text as already shared. |
| I removed someone. | The note is encrypted again under a new key for the others. A copy they already hold (history, a backup) stays readable. |
| Can the operator read my notes? | The operator who runs the server can read the memory of the process while you are unlocked, and can add a recipient key they control to the keyring. Private notes protect against the disk, the repository, backups, other users and models, not against a hostile server. |
| Search | Words only, over the notes your unlocked keys open. There is no search by meaning for private notes: an embedding of private text is private text. |
| Questions (`ask`) | Private passages can answer a question, but the answer is then extractive: it quotes your notes and no language model writes it, unless the operator sets `DFL_PRIVATE_LLM=allow`. Deep search never uses private notes. |
| GitHub | A private note cannot be sent to GitHub as an issue. |
| Live editing | Private notes have no shared editing room: their text must not enter a shared document. |
| History | The history of a private note lists commits but shows no diff: a diff of ciphertext says nothing. |
| Lost passphrase or lost database | The notes cannot be opened. Keep the downloaded key backup and its passphrase. |

Wrong passphrases answer 403, not 401: the person is signed in.
