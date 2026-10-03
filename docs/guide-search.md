---
type: note
status: approved
owner: clement
tags: [guide, search]
links:
  - "[[guide-getting-started|related]]"
  - "[[guide-mcp|related]]"
  - "[[guide-deploy|related]]"
  - "[[guide-api|related]]"
---
# Search

Defluance finds notes four ways. You pick the mode next to the search box, or with `mode=` in the API.

| Mode | Does | Needs |
|------|------|-------|
| **Words** (`keyword`) | Matches the words you type, also their beginnings, ignoring case and accents | nothing |
| **Meaning** (`meaning`) | Finds text that says the same thing in other words, in any language | a meaning model |
| **Auto** (`hybrid`, default) | Both, fused. Names, acronyms and identifiers still match by their letters | works with or without a meaning model |
| **Smart** (`smart`) | A language model rewrites the question into several searches (and the other language), guesses filters such as "approved specs", and can order the results | a language model |

Every result shows the matched words highlighted, the best passages of the note, and whether it was found by words, by meaning, or both.

## Turn on search by meaning

Out of the box, vectors are built from the words themselves: that is better than nothing for typos and word forms, but it does not understand that "password recovery email" and "reset link" are the same thing. A real embedding model does. Pick one:

**On your machine, nothing leaves it (recommended to start):**

```bash
npx defluance models install      # once: the runtime (about 480 MB) and a multilingual model (about 120 MB)
DFL_EMBED=local npx defluance serve ./my-notes
```

The model is `Xenova/paraphrase-multilingual-MiniLM-L12-v2`: 384 dimensions, English, French and about 50 other languages, a few hundred passages per second on a laptop CPU. Another model from Hugging Face: `DFL_EMBED=local:<org>/<model>`. Files go to `~/.defluance` (`DFL_RUNTIME_DIR`, `DFL_MODEL_CACHE`).

**A model server you already run:**

```bash
DFL_EMBED=ollama:nomic-embed-text   OLLAMA_BASE_URL=http://localhost:11434/v1
DFL_EMBED=openai:text-embedding-3-small   OPENAI_API_KEY=...
DFL_EMBED=openai-compatible:<model>   DFL_AI_BASE_URL=... DFL_AI_API_KEY=...
```

With Docker: `docker build --build-arg EMBED=local -t defluance:local .` bakes the model into the image, or use the published `-local` image.

**Indexing does not block anything.** Notes are searchable by words immediately. Vectors are computed in the background, with a progress bar at the top of the app, and Meaning search improves as they arrive. A 10,000-note vault takes a couple of minutes with the local model. If the model cannot load (download failed, provider down), the app says so, keeps searching by words, and retries every minute. Changing `DFL_EMBED` re-embeds the vault once.

## Smart search and deep questions

Set a language model on the server: `DFL_LLM=anthropic:claude-sonnet-5-5` (or `openai:`, `ollama:`, `gateway:`). `DFL_LLM=mock` is a canned offline model for demos (id `mock:demo`): it answers with citations, rewrites searches and drafts notes, but has no tool calling, so deep search is not offered.

- **Smart search** makes one model call to plan, and one more if you tick rerank. The model sees your question, and the list of note types and statuses of the vault. It sees note text only when reranking (the first lines of the top results). It can only turn its guesses into filters that exist in your vault, and a guessed filter that leaves fewer than three results is dropped. The panel "Understood as" shows what it did.
- **Research in depth** (a checkbox next to Ask) lets the model search, read notes and follow links over up to six steps before it answers, for questions that span several specs ("what breaks if we change sessions?"). It needs a model that supports tools. The answer lists the steps it took, and, as always, every citation is a passage it was actually given.
- Neither can reach a note you may not read: they go through the same space permissions as everything else.

Rather than the server's model, an agent can do the searching itself: connect it over MCP ([[guide-mcp]]) and it uses `search`, `read_note` and `graph_neighbors` directly, with its own model.

## How good is it

`defluance eval <questions.yaml> --vault <folder> --search` measures how often the right note comes first. On the repository's fixture (14 notes in English and French, 22 paraphrased questions that share almost no words with their note, 6 exact-term questions, 4 unanswerable ones):

| | Paraphrases, right note first | Exact terms, right note first | Right note in the top 3, all questions |
|---|---|---|---|
| Words | 50% | 100% | 75% |
| Meaning (local model) | 91% | 100% | 96% |
| Auto (local model) | 82% | 100% | 96% |

Read these as a sanity check, not a benchmark: the vault is tiny and the paraphrases were written for the test. On a large vault, exact terms get harder for meaning alone, which is why Auto is the default. Bring your own questions in the same YAML format (`q`, `expect`, `refuse`) to measure your own vault. CI keeps the offline baseline from regressing, and a nightly job can run the same set against a real model.

## Limits

- Vectors are compared in memory: fine up to about 50,000 passages (a vault of 10,000 notes answers in about 30 ms). Beyond that, a vector index such as pgvector is the next step.
- The local model reads about 85 words at a time. Longer passages are embedded in pieces and averaged, so very long sections blur.
- "Unrelated" starts at a model-specific similarity (0.2 for the default model). Questions that are close to your topics but not answered in your notes can still return the nearest note: that is why answers always show their sources.
