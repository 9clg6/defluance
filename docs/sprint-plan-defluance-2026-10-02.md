# Sprint Plan : Defluance

**Date :** 2026-10-02
**Scrum Master :** clement
**Niveau de projet :** 3
**Stories :** 42
**Points :** 165
**Sprints :** 6 × 2 semaines
**Cible :** release 0.1 le 2026-12-25

---

## Résumé

Six sprints de deux semaines, du 2026-10-05 au 2026-12-25. Ordre : format de vault → index et graphe → API, MCP et RAG → GitHub → UI → déploiement et release. Une tranche verticale testable dans Claude Code (vault → index → MCP `search` / `read_note`) est disponible fin du sprint 3.

**Capacité :** 1 dev senior + agents IA, 10 jours × 6 h = 60 h, 1 point = 2 h → 30 points par sprint. Plan à 165 / 180 points (92 %). Marge faible : les Should Have sont les premières candidates au report.

---

## Inventaire des stories

Format : ID, titre, epic, priorité, points, critères d'acceptation clés, dépendances.

### EPIC-001 : format de vault et schéma

- **STORY-001 Monorepo et CI de base** — infra, Must, 3 pts. pnpm workspaces, Turborepo, TS strict, ESLint, Vitest, GitHub Actions lint + typecheck + test. Déps : aucune.
- **STORY-002 Parser markdown et wikilinks typés** — Must, 5 pts. gray-matter + remark ; extrait titre, headings, `[[cible|type]]`, liens `gh:` ; type absent = `related`. Tests sur fixtures. Déps : 001.
- **STORY-003 Schéma de fiche et validation** — Must, 3 pts. `.defluance/schema.yaml` → Zod ; types, statuts, types de lien ; erreurs avec chemin et ligne. Déps : 002.
- **STORY-004 Résolution de liens compatible Obsidian** — Must, 3 pts. slug, alias, chemins relatifs, `#heading` ; vault de conformité `fixtures/vault-obsidian` parsé sans erreur. Déps : 002.
- **STORY-005 Opérations git** — Must, 5 pts. simple-git : lecture à une révision, écriture + commit (auteur paramétrable), branche, log de fichier, diff, détection de conflit par SHA de base. Déps : 001.
- **STORY-006 CLI `init` et `validate`** — Must, 3 pts. Exit code non nul sur erreur, orphelins en avertissement, < 5 s sur 1 000 fiches. Déps : 003, 004.
- **STORY-007 Templates et CLI `new`** — Should, 2 pts. `.defluance/templates/<type>.md`, 6 templates fournis, rechargés sans redémarrage. Déps : 003.
- **STORY-008 Spec publique du format et dogfooding** — Must, 2 pts. `docs/vault-format.md` ; le dossier `docs/` du dépôt devient un vault valide. Déps : 006.

### EPIC-002 : indexation et graphe

- **STORY-009 `IndexStore` et `SqliteStore`** — Must, 5 pts. Drizzle, tables `notes`, `chunks`, `edges`, `index_state`, FTS5, sqlite-vec, migrations. Déps : 001.
- **STORY-010 Indexation complète et chunking** — Must, 5 pts. Chunk par heading (~800 tokens, chevauchement 10 %), arêtes résolues (`to_note` null = cassé), rebuild idempotent. Déps : 002, 004, 009.
- **STORY-011 Indexation incrémentale et jobs** — Must, 5 pts. Diff `last_commit..HEAD`, table `jobs` persistée, worker in-process, retry exponentiel ; < 5 s par commit. Déps : 005, 010.
- **STORY-012 Provider IA et embeddings cachés** — Must, 3 pts. Factory AI SDK depuis `DFL_LLM` / `DFL_EMBED` (Anthropic, OpenAI-compatible, Ollama) ; cache embeddings par hash ; changement de modèle = rebuild. Déps : 009.
- **STORY-013 Recherche hybride** — Must, 5 pts. FTS top 50 + vecteurs top 50 → RRF → filtres `type`, `status`, `tags`, `owner`, espace. Déps : 010, 012.
- **STORY-014 Requêtes de graphe** — Must, 5 pts. `neighbors` (type, direction, profondeur), `path`, `impact` (CTE récursive, profondeur max 5), `lint` (orphelins, cassés). Déps : 010.

### EPIC-003 : API, MCP et sécurité

- **STORY-015 Serveur Hono et endpoints lecture** — Must, 5 pts. OpenAPI généré, problem+json, pagination curseur, `/health`, `notes` list/get/links, `search`, `graph/*`, `openapi.json`. Déps : 013, 014.
- **STORY-016 Endpoints écriture** — Must, 5 pts. `POST notes`, `PUT` avec `base_commit` (409 si divergent), `PATCH status`, `POST links` ; commit + job index ; mode `direct|branch`. Déps : 005, 015.
- **STORY-017 Tokens scopés, espaces et rôles** — Must, 5 pts. Tokens `dfl_` hachés, scopes `read|write|issues`, espaces par préfixe, rôles `reader|editor|admin`, middleware, révocation < 10 s, rate limit. Déps : 015.
- **STORY-018 Journal d'audit** — Must, 3 pts. Toute écriture journalisée (acteur, action, cible, commit) ; `GET audit` filtrable ; non modifiable. Déps : 016, 017.
- **STORY-019 Serveur MCP** — Must, 5 pts. 10 outils sur les mêmes services ; HTTP streamable `/mcp` + `defluance mcp` stdio in-process ; scopes appliqués ; testé avec Claude Code. Déps : 016, 017.

### EPIC-005 : RAG citant

- **STORY-020 Outil `ask` avec citations obligatoires** — Must, 5 pts. Récupération filtrée → génération → citations `[note#heading@commit]` validées → refus sans source ; SSE optionnel ; exposé REST et MCP. Déps : 013, 019.
- **STORY-021 Jeu d'évaluation RAG** — Must, 2 pts. 30 questions sur le vault de fixtures, 100 % citations valides, job CI nightly avec provider local. Déps : 020.

### EPIC-004 : connecteur GitHub

- **STORY-022 GitHub App et webhooks** — Must, 5 pts. Auth App + installation tokens, `/webhooks/github` avec vérification HMAC (401 sinon), événements `issues`, `pull_request`, `push`, `installation` → jobs. Déps : 011, 017.
- **STORY-023 Nœuds GitHub et liens `gh:`** — Must, 5 pts. Table `gh_nodes`, upsert < 5 s, résolution `[[gh:owner/repo#n|tracked_by]]` dans le graphe, état visible, `resync` complet. Déps : 014, 022.
- **STORY-024 Création d'issue depuis une fiche** — Must, 3 pts. REST + MCP `create_issue`, issue avec URL de la fiche, lien `tracked_by` ajouté par commit, dépôt choisi parmi ceux de l'espace. Déps : 023.
- **STORY-025 Statut dérivé à la merge** — Should, 3 pts. PR mergée → fiches `approved` liées → `implemented` par commit `defluance-bot`, journalisé, désactivable. Déps : 023.
- **STORY-026 Analyse d'impact PR** — Should, 3 pts. `graph/impact?pr=` via `tracked_by` et `paths` des `component` ; commentaire PR optionnel. Déps : 023.
- **STORY-027 OAuth GitHub et sessions** — Must, 3 pts. Login GitHub, cookie signé HttpOnly 7 jours, utilisateur en base, membres d'espace. Déps : 017.
- **STORY-028 `PostgresStore`** — Must, 5 pts. pgvector + tsvector, même suite de tests que SQLite, matrice CI SQLite/Postgres. Déps : 009, 013, 014.

### EPIC-006 : UI web

- **STORY-029 Scaffold Next.js, ObsidianUI, thème, auth** — Must, 5 pts. App Router, Tailwind, composants ObsidianUI copiés, primitives Radix, thème clair/sombre, `prefers-reduced-motion`, session serveur, layout avec navigation. Déps : 027.
- **STORY-030 Page fiche** — Must, 5 pts. `/n/[slug]`, rendu markdown sanitisé, wikilinks cliquables, Mermaid, panneau métadonnées, liens entrants/sortants par type, nœuds GitHub avec état. Déps : 015, 023, 029.
- **STORY-031 Palette de recherche** — Must, 3 pts. `Cmd+K`, résultats hybrides, filtres, navigation clavier. Déps : 029.
- **STORY-032 Vue graphe** — Must, 5 pts. Graphe local (profondeur N) et global, filtres type de lien / fiche / statut, couleur par type, clic = navigation, fluide à 200 nœuds. Déps : 014, 029.
- **STORY-033 Éditeur markdown avec commit** — Must, 8 pts. CodeMirror 6, autocomplétion `[[` et types de lien, prévisualisation, sauvegarde = commit (SHA affiché), 409 affiché sans écrasement, mode branche selon rôle. Déps : 016, 029.
- **STORY-034 Actions depuis la fiche** — Must, 3 pts. Changer statut, créer issue (formulaire pré-rempli), « Demander » filtré sur la fiche et son sous-graphe, onglet audit de la fiche. Déps : 018, 020, 024, 030.

### EPIC-007 : déploiement et finitions

- **STORY-035 Historique de fiche** — Should, 3 pts. Liste des commits, diff côte à côte < 1 s pour 50 commits. Déps : 005, 030.
- **STORY-036 Setup GitHub App et paramètres d'espace** — Must, 3 pts. `/setup/github` guidé, gestion tokens et membres par espace dans l'UI. Déps : 017, 022, 029.
- **STORY-037 Page audit et i18n** — Should, 2 pts. `/audit` filtrable, `next-intl` avec `en` et `fr`. Déps : 018, 029.
- **STORY-038 Docker Compose** — Must, 3 pts. server, web, postgres, Caddy ; migrations au démarrage ; variables documentées. Déps : 028, 029.
- **STORY-039 CLI `serve` avec UI embarquée** — Must, 5 pts. `npx defluance serve <vault>` : SQLite, API, MCP, Next standalone ; vault existant → UI en < 10 min. Déps : 019, 029.
- **STORY-040 Observabilité** — Should, 3 pts. pino JSON, `/metrics` Prometheus, dashboard Grafana dans `deploy/`. Déps : 015.
- **STORY-041 Benchmarks et accessibilité en CI** — Must, 3 pts. Vault synthétique 10 000 fiches, seuils NFR-001/002 ; Playwright + axe sur lecture, recherche, édition. Déps : 013, 033.
- **STORY-042 Documentation et release 0.1** — Must, 3 pts. Doc d'installation (local, Compose), guide MCP Claude Code, licence tranchée, tags semver, images GHCR, package npm. Déps : toutes.

---

## Allocation par sprint

### Sprint 1 — 2026-10-05 → 2026-10-16 — 26 / 30 pts

**Objectif :** le format de vault est spécifié, parsé, validé et versionné ; `defluance validate` tourne en CI sur `docs/`.

STORY-001 (3), 002 (5), 003 (3), 004 (3), 005 (5), 006 (3), 007 (2), 008 (2).

**Risques :** conformité wikilinks Obsidian (cas limites alias / headings) ; mitigation : fixture de conformité dès le départ.

### Sprint 2 — 2026-10-19 → 2026-10-30 — 28 / 30 pts

**Objectif :** un vault est indexé (plein texte, vecteurs, graphe), interrogeable en recherche hybride et en requêtes de graphe, avec indexation incrémentale.

STORY-009 (5), 010 (5), 011 (5), 012 (3), 013 (5), 014 (5).

**Risques :** sqlite-vec et better-sqlite3 (compilation native, versions Node) ; mitigation : verrouiller Node 24 et tester l'install en CI dès le jour 1 du sprint.

### Sprint 3 — 2026-11-02 → 2026-11-13 — 28 / 30 pts

**Objectif :** API REST et MCP utilisables depuis Claude Code avec tokens scopés, audit et `ask` citant. Première démo agent.

STORY-015 (5), 016 (5), 017 (5), 018 (3), 019 (5), 020 (5).

**Risques :** qualité des citations RAG ; mitigation : consigne stricte + validation structurelle, évaluation au sprint 4.

### Sprint 4 — 2026-11-16 → 2026-11-27 — 29 / 30 pts

**Objectif :** boucle spec → issue → PR → statut fermée côté serveur ; Postgres supporté ; login GitHub.

STORY-021 (2), 022 (5), 023 (5), 024 (3), 025 (3), 026 (3), 027 (3), 028 (5).

**Risques :** webhooks en local (tunnel) ; mitigation : payloads enregistrés pour les tests, smee.io pour le dev.

### Sprint 5 — 2026-11-30 → 2026-12-11 — 29 / 30 pts

**Objectif :** UI web complète pour lire, chercher, naviguer le graphe, éditer avec commit et agir depuis la fiche.

STORY-029 (5), 030 (5), 031 (3), 032 (5), 033 (8), 034 (3).

**Risques :** STORY-033 (8 pts) est la plus grosse ; si elle déborde, reporter 034 au sprint 6 et décaler 037.

### Sprint 6 — 2026-12-14 → 2026-12-25 — 25 / 30 pts

**Objectif :** installation en une commande, observabilité, benchmarks, doc, release 0.1.

STORY-035 (3), 036 (3), 037 (2), 038 (3), 039 (5), 040 (3), 041 (3), 042 (3).

**Risques :** semaine de Noël ; marge de 5 pts prévue, 035 / 037 / 040 reportables en 0.1.1.

---

## Traçabilité epics

| Epic | Stories | Points | Sprints |
|------|---------|--------|---------|
| EPIC-001 Format de vault | 001-008 | 26 | 1 |
| EPIC-002 Index et graphe | 009-014 | 28 | 2 |
| EPIC-003 API, MCP, sécurité | 015-019 | 23 | 3 |
| EPIC-005 RAG | 020-021 | 7 | 3-4 |
| EPIC-004 GitHub | 022-028 | 27 | 4 |
| EPIC-006 UI | 029-034 | 29 | 5 |
| EPIC-007 Déploiement | 035-042 | 25 | 6 |

## Couverture des FR

| FR | Stories | Sprint |
|----|---------|--------|
| FR-001 | 005, 008, 016 | 1, 3 |
| FR-002 | 003 | 1 |
| FR-003 | 002, 004 | 1 |
| FR-004 | 006 | 1 |
| FR-005 | 007 | 1 |
| FR-006 | 009, 010, 011 | 2 |
| FR-007 | 013 | 2 |
| FR-008 | 014 | 2 |
| FR-009 | 025 | 4 |
| FR-010 | 015, 016 | 3 |
| FR-011 | 019 | 3 |
| FR-012 | 017, 027 | 3, 4 |
| FR-013 | 018 | 3 |
| FR-014 | 017, 036 | 3, 6 |
| FR-015 | 022 | 4 |
| FR-016 | 023 | 4 |
| FR-017 | 024 | 4 |
| FR-018 | 026 | 4 |
| FR-019 | 020, 021 | 3, 4 |
| FR-020 | 012 | 2 |
| FR-021 | 030 | 5 |
| FR-022 | 031 | 5 |
| FR-023 | 032 | 5 |
| FR-024 | 033 | 5 |
| FR-025 | 034 | 5 |
| FR-026 | 035 | 6 |
| FR-027 | 038, 039, 042 | 6 |

NFR : NFR-001/002 → 041 ; NFR-003 → 017, 022 ; NFR-004 → 004, 008 ; NFR-005 → 011, 023 ; NFR-006 → 029, 041 ; NFR-007 → 001 ; NFR-008 → 002, 015, 019 ; NFR-009 → 037 ; NFR-010 → 040.

---

## Risques globaux

**Élevés**
- Capacité à 92 % sur 6 sprints avec une personne : tout dérapage décale la 0.1. Mitigation : Should Have reportables (007, 025, 026, 035, 037, 040 = 16 pts).
- Éditeur avec commit et conflits (033) : complexité sous-estimée possible. Mitigation : prototype CodeMirror dès le sprint 4 en tâche de fond.

**Moyens**
- Modules natifs SQLite (compilation, versions Node). Mitigation : CI d'install multi-OS au sprint 2.
- Qualité RAG sans reranker. Mitigation : évaluation au sprint 4, reranker en 0.2 si nécessaire.
- ObsidianUI jeune et orienté effets : composants manquants. Mitigation : Radix pour les primitives.

**Faibles**
- Quotas GitHub : webhooks + cache.

## Dépendances externes

- Compte GitHub pour créer la GitHub App et l'OAuth App (sprint 4).
- Ollama local ou clé API provider pour embeddings et `ask` (sprint 2-3).
- Un vault Obsidian réel pour tests de conformité (sprint 1).

---

## Definition of Done

- [ ] Code committé, CI verte (lint, typecheck, tests).
- [ ] Tests unitaires sur la logique, intégration sur API/MCP ; couverture ≥ 70 % sur le cœur.
- [ ] Critères d'acceptation vérifiés.
- [ ] Doc mise à jour (`docs/` du vault, OpenAPI si API).
- [ ] Revue (humaine ou agent) effectuée.
- [ ] Pas de régression de benchmark.

---

## Prochaines étapes

Sprint 1 démarre le 2026-10-05. Lancer `/bmad:dev-story STORY-001` puis enchaîner 002 → 005 en parallèle (indépendantes) et 003, 004, 006, 007, 008.

Cadence : planning lundi semaine 1, revue et rétro vendredi semaine 2.

---

**Plan créé avec BMAD Method v6 - Phase 4 (Implementation Planning)**
