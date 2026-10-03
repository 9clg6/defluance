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
  - "[[guide-search|related]]"
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

## Rédiger avec un modèle de langage et des templates

Avec un modèle configuré (`DFL_LLM`, voir [[guide-search]]), l'éditeur d'une fiche propose de **compléter** les sections vides d'après le template du type, ou d'**améliorer** le texte selon une consigne. Le texte proposé s'affiche pour relecture : rien n'est enregistré tant que vous ne l'acceptez pas. Le modèle ne change jamais `type`, `status` ni `owner` (c'est vous qui approuvez), et les liens vers des fiches qui n'existent pas sont retirés avec un avertissement. Il s'appuie sur la fiche, ses liens et quelques fiches publiques proches, uniquement celles que vous avez le droit de lire. Une fiche privée n'est envoyée au modèle que si l'opérateur a mis `DFL_PRIVATE_LLM=allow` et que votre clé est déverrouillée.

Les templates sont des fichiers `.defluance/templates/<nom>.md` que les administrateurs peuvent créer, modifier ou supprimer par l'API (`GET/PUT/DELETE /api/v1/templates`). Un commentaire `<!-- ai: consigne -->` guide le modèle pour sa section et disparaît des fiches créées à la main. Format complet : [[vault-format]].

### Démo sans service externe

Pour montrer l'outil hors ligne, deux simulations existent. Elles ne s'activent que par un nom explicite, jamais par défaut :

```bash
DFL_LLM=mock DFL_GITHUB=mock npx defluance serve ./my-notes
```

- `DFL_LLM=mock` : un faux modèle déterministe (`mock:demo`) qui rédige des fiches plausibles, répond aux questions avec des citations `[n]` tirées des sources et réécrit la recherche intelligente. Il n'appelle aucun outil : la recherche approfondie (« deep ») n'est donc pas proposée.
- `DFL_GITHUB=mock` : un faux GitHub dans le processus, avec six issues et pull requests pour `acme/app`, ou celles du fichier JSON `DFL_GITHUB_MOCK_FILE` (tableau d'objets `{ key: "acme/app#12", kind, state, title, labels, author, files, merged_at, url, updated_at }`). Ils apparaissent dans le graphe et sur les fiches liées ; rien ne part vers GitHub.

Le démarrage affiche une ligne `MOCK MODE: …` par simulation, et `/health` indique `mock (demo model, canned answers)` et `github: mock`, pour qu'une capture d'écran ne passe pas pour du réel.

## Check the vault

```bash
defluance validate ./my-notes
```

It reports missing fields, unknown types and statuses, broken links, and notes nobody links to. Errors give exit code 1. In GitHub Actions:

```yaml
- run: npx defluance validate docs
```

## Search and ask

- `Ctrl+K` (`Cmd+K` on Mac) searches every note. Filter by type or status, and pick a mode. The **Search** page has the full results with the matched words highlighted.
- The home page and each note's **Ask** tab answer questions in plain language and always list their sources. On a note, only that note and the notes linked to it are used.
- By default search matches words. To find text that says the same thing in other words, in any language, install a meaning model: `defluance models install`, then `DFL_EMBED=local`. Everything about modes, models, smart search and in-depth questions is in [[guide-search]].

## Next

- Let an agent read and draft: [[guide-mcp]]
- Link specs to issues and pull requests: [[guide-github]]
- Run it for a team: [[guide-deploy]]

## Démo locale

`pnpm demo` démarre une démo complète d'un SaaS fictif, Acme Pay : une cinquantaine de notes (specs, ADR, composants, runbooks, notes de réunion), dix semaines d'historique git avec plusieurs auteurs, des brouillons d'agents à relire, une note privée et un journal d'audit rempli. Il faut avoir construit le projet avant (`pnpm build`).

```bash
pnpm demo                 # http://localhost:4000, Ctrl+C pour arrêter
pnpm demo --port 4100     # ou PORT=4100
pnpm demo --plain         # sans les mocks LLM et GitHub
pnpm demo --check         # démarre, remplit, vérifie, s'arrête (code 0 ou 1)
```

Le vault vit dans un dossier temporaire, supprimé à l'arrêt : chaque lancement repart de zéro. Les secrets affichés (token admin `dfl_demo_token_local`, tokens d'agents, passphrase `demo-passphrase-2026`) sont jetables.

Ce qui est factice : les réponses du LLM sont préparées (`DFL_LLM=mock`), les issues et PR GitHub viennent de `fixtures/vault-showcase/github.json` (`DFL_GITHUB=mock`) et les embeddings sont de simples empreintes (`DFL_EMBED=hash`). La clé privée de l'admin est verrouillée au départ, pour tester le déverrouillage.
