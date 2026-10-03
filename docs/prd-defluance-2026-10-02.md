---
type: note
status: review
owner: clement
tags: [defluance, bmad]
links:
  - "[[product-brief-defluance-2026-10-02|implements]]"
  - "[[architecture-defluance-2026-10-02|related]]"
---

# PRD : Defluance

**Date :** 2026-10-02
**Auteur :** clement
**Version :** 1.0
**Type de projet :** web-app
**Niveau de projet :** 3
**Statut :** Draft

---

## Présentation du document

Ce PRD définit les exigences fonctionnelles et non fonctionnelles de Defluance. Il sert de source de vérité sur ce qui sera construit et assure la traçabilité exigences → epics → stories.

**Documents liés :**
- Product brief : docs/product-brief-defluance-2026-10-02.md (validé)
- Brainstorm : docs/brainstorming-defluance-2026-10-02.md

---

## Résumé exécutif

Defluance est un second cerveau d équipe source-available pour le développement logiciel assisté par IA. Un vault git de fiches markdown liées par un graphe typé est la source de vérité. Un indexeur, une API REST, un serveur MCP (Model Context Protocol) et une GitHub App l'exposent aux humains et aux agents IA. Une UI web Next.js construite avec ObsidianUI (React, TypeScript, Tailwind, Motion) consomme la même API. Boucle cible : spec → issue → PR → statut, avec RAG citant ses sources.

---

## Objectifs produit

### Objectifs business

- MVP source-available utilisable sur un vault Obsidian existant d'ici fin décembre 2026.
- 5 équipes pilotes dans les 3 mois suivant la release.
- Référence « specs + agents IA » : 1 000 étoiles GitHub à 12 mois.

### Métriques de succès

- Vault existant indexé et interrogeable via MCP en moins de 10 minutes après installation.
- Part des specs `approved` avec au moins une PR mergée liée (couverture).
- 100 % des réponses RAG avec citation valide (fiche + commit).
- Appels MCP par semaine par équipe.
- Installations, étoiles, contributeurs.

---

## Exigences fonctionnelles

Les FR définissent **ce que** fait le système. Priorisation MoSCoW.

---

### Domaine A : format de vault et schéma

### FR-001 : Vault markdown + frontmatter comme source de vérité

**Priorité :** Must Have

**Description :**
Le système lit et écrit des fiches sous forme de fichiers `.md` avec frontmatter YAML dans un dépôt git. Aucune donnée de fiche n'existe hors du vault. Le vault reste ouvrable dans Obsidian et dans un IDE sans Defluance.

**Critères d'acceptation :**
- [ ] Un vault Obsidian existant est accepté sans migration.
- [ ] Toute écriture via API ou UI produit un commit git.
- [ ] Supprimer Defluance laisse un vault markdown complet et lisible.

**Dépendances :** aucune

### FR-002 : Schéma de fiche minimal et types de fiche

**Priorité :** Must Have

**Description :**
Chaque fiche porte un frontmatter avec au minimum `type`, `status`, `owner`, `tags`. Types fournis : `functional-spec`, `technical-spec`, `adr`, `note`, `glossary`, `component`, `issue`, `pull-request`. Les types étendent le schéma minimal avec des champs propres (ex. `acceptance_criteria` pour `functional-spec`).

**Critères d'acceptation :**
- [ ] Le schéma est documenté dans un fichier public du vault (`.defluance/schema.yaml`).
- [ ] Une fiche sans `type` est signalée en erreur par la validation.
- [ ] Les statuts autorisés sont `draft`, `review`, `approved`, `implemented`, `deprecated`.

**Dépendances :** FR-001

### FR-003 : Liens typés entre fiches

**Priorité :** Must Have

**Description :**
Les liens utilisent la syntaxe wikilink `[[cible]]` ou `[[cible|type]]`. Types fournis : `implements`, `depends_on`, `supersedes`, `tested_by`, `tracked_by`, `blocks`, `related`. Un lien sans type vaut `related`. Les liens peuvent aussi être déclarés dans le frontmatter (`links:`).

**Critères d'acceptation :**
- [ ] `[[auth-login|implements]]` est parsé comme arête `implements` vers `auth-login`.
- [ ] Obsidian affiche ces liens comme des wikilinks avec alias, sans erreur.
- [ ] Un type de lien inconnu est signalé par la validation.

**Dépendances :** FR-002

### FR-004 : Validation du vault en CLI

**Priorité :** Must Have

**Description :**
La commande `defluance validate` vérifie schéma de fiches, types de liens, liens cassés, fiches orphelines, et retourne un code de sortie non nul en cas d'erreur, utilisable en CI.

**Critères d'acceptation :**
- [ ] Erreurs listées avec chemin de fichier et ligne.
- [ ] Les fiches orphelines sont des avertissements, pas des erreurs.
- [ ] Exécution sur 1 000 fiches en moins de 5 secondes.

**Dépendances :** FR-002, FR-003

### FR-005 : Templates de fiches

**Priorité :** Should Have

**Description :**
Le vault contient des templates par type dans `.defluance/templates/`. `defluance new <type> <titre>` et l'UI créent une fiche depuis le template.

**Critères d'acceptation :**
- [ ] Templates fournis pour les 6 types rédigeables.
- [ ] Un template modifié dans le vault est utilisé sans redémarrage.

**Dépendances :** FR-002

---

### Domaine B : indexation et graphe

### FR-006 : Indexeur reconstructible

**Priorité :** Must Have

**Description :**
`defluance index` construit depuis le vault un index plein texte, des embeddings par chunk et une table d'arêtes. L'index est jetable et reconstruit à l'identique depuis le vault.

**Critères d'acceptation :**
- [ ] Suppression de l'index puis réindexation donne les mêmes résultats de recherche.
- [ ] Indexation incrémentale sur les fichiers modifiés depuis le dernier commit indexé.
- [ ] Chaque chunk conserve `fiche`, `heading`, `commit`.

**Dépendances :** FR-001, FR-003

### FR-007 : Recherche plein texte et sémantique

**Priorité :** Must Have

**Description :**
Recherche hybride (BM25 + vecteurs) avec filtres par `type`, `status`, `tags`, `owner`. Résultats avec extrait et score.

**Critères d'acceptation :**
- [ ] Une requête retourne les fiches pertinentes même sans correspondance exacte de mots.
- [ ] Les filtres se combinent.
- [ ] Résultat en moins de 300 ms sur 10 000 fiches.

**Dépendances :** FR-006

### FR-008 : Requêtes de graphe

**Priorité :** Must Have

**Description :**
L'API expose : voisins d'une fiche filtrés par type de lien et direction, chemin entre deux fiches, sous-graphe d'impact (toutes les fiches atteignables via `depends_on` / `implements` à profondeur N).

**Critères d'acceptation :**
- [ ] `graph/neighbors?id=X&link=depends_on&direction=in` retourne les dépendants.
- [ ] `graph/impact?id=X&depth=3` retourne un sous-graphe avec arêtes typées.
- [ ] Profondeur maximale configurable, défaut 5.

**Dépendances :** FR-006

### FR-009 : Statut de fiche dérivé des événements

**Priorité :** Should Have

**Description :**
Une fiche `approved` liée par `tracked_by` à une PR mergée passe automatiquement à `implemented`. La transition est écrite dans le frontmatter via commit signé « defluance-bot ».

**Critères d'acceptation :**
- [ ] Merge d'une PR liée → commit modifiant `status: implemented`.
- [ ] Transition journalisée avec l'événement source.
- [ ] Désactivable par configuration.

**Dépendances :** FR-003, FR-016

---

### Domaine C : API et MCP

### FR-010 : API REST documentée

**Priorité :** Must Have

**Description :**
API REST avec spec OpenAPI : CRUD fiches, liens, recherche, graphe, statut d'index, événements GitHub. Les écritures acceptent un message de commit optionnel.

**Critères d'acceptation :**
- [ ] `openapi.json` servi par le serveur et validé en CI.
- [ ] Toute écriture retourne le SHA du commit créé.
- [ ] Erreurs au format problem+json.

**Dépendances :** FR-001, FR-006, FR-008

### FR-011 : Serveur MCP

**Priorité :** Must Have

**Description :**
Serveur MCP exposant les outils : `search`, `read_note`, `list_notes`, `graph_neighbors`, `graph_impact`, `create_draft`, `update_note`, `link_notes`, `create_issue`, `ask` (RAG). Transport stdio et HTTP streamable.

**Critères d'acceptation :**
- [ ] Claude Code se connecte et liste les 10 outils.
- [ ] `create_draft` crée une fiche `status: draft` sur une branche et retourne son chemin.
- [ ] Les outils d'écriture sont refusés si le token n'a pas le scope `write`.

**Dépendances :** FR-010

### FR-012 : Authentification et tokens scopés

**Priorité :** Must Have

**Description :**
Utilisateurs humains authentifiés par OAuth GitHub. Agents authentifiés par tokens API avec scopes `read`, `write`, `issues`, limités à un ou plusieurs espaces.

**Critères d'acceptation :**
- [ ] Token `read` ne peut pas appeler `update_note`.
- [ ] Token limité à l'espace `produit` ne voit pas `infra`.
- [ ] Révocation effective en moins de 10 secondes.

**Dépendances :** FR-010

### FR-013 : Journal d'audit des actions

**Priorité :** Must Have

**Description :**
Chaque écriture (fiche, lien, issue, statut) est journalisée avec acteur (humain ou token), outil, horodatage, commit résultant. Consultable via API et UI.

**Critères d'acceptation :**
- [ ] Une création de fiche par agent apparaît avec le nom du token.
- [ ] Journal filtrable par acteur, type d'action, fiche, période.
- [ ] Journal non modifiable via API.

**Dépendances :** FR-012

### FR-014 : Espaces et permissions

**Priorité :** Should Have

**Description :**
Un espace est un dossier racine du vault. Rôles par espace : `reader`, `editor`, `admin`. Les permissions s'appliquent à l'API, au MCP et à l'UI.

**Critères d'acceptation :**
- [ ] Un `reader` ne peut pas committer.
- [ ] Un `admin` gère les tokens de son espace.
- [ ] Vault sans configuration = un seul espace `default`, tous `editor`.

**Dépendances :** FR-012

---

### Domaine D : connecteur GitHub

### FR-015 : GitHub App et webhooks

**Priorité :** Must Have

**Description :**
Defluance s'installe comme GitHub App sur un ou plusieurs dépôts. Il reçoit les webhooks `issues`, `pull_request`, `push` et maintient un cache local. Aucun polling.

**Critères d'acceptation :**
- [ ] Installation guidée depuis l'UI.
- [ ] Un webhook reçu met à jour le cache en moins de 5 secondes.
- [ ] Resynchronisation complète à la demande.

**Dépendances :** FR-012

### FR-016 : Issues et PR comme nœuds du graphe

**Priorité :** Must Have

**Description :**
Chaque issue et PR des dépôts connectés est un nœud virtuel de type `issue` ou `pull-request` (titre, état, labels, auteur, fichiers touchés pour les PR). Les fiches les référencent par `[[gh:owner/repo#123|tracked_by]]`.

**Critères d'acceptation :**
- [ ] Un lien `gh:` résout vers le nœud GitHub dans le graphe et l'UI.
- [ ] L'état (`open`, `closed`, `merged`) est visible sur la fiche liée.
- [ ] Les nœuds GitHub ne sont pas écrits dans le vault (cache seulement), sauf export explicite.

**Dépendances :** FR-003, FR-015

### FR-017 : Création d'issue depuis une fiche

**Priorité :** Must Have

**Description :**
Depuis une fiche (UI, API, MCP), créer une issue GitHub pré-remplie avec titre, extrait et lien vers la fiche. Le lien `tracked_by` est ajouté automatiquement à la fiche.

**Critères d'acceptation :**
- [ ] L'issue contient une URL permanente vers la fiche.
- [ ] La fiche reçoit `[[gh:owner/repo#N|tracked_by]]` par commit.
- [ ] Dépôt cible choisi parmi ceux connectés à l'espace.

**Dépendances :** FR-016

### FR-018 : Analyse d'impact PR → specs

**Priorité :** Should Have

**Description :**
Pour une PR, lister les specs potentiellement impactées : fiches liées par `tracked_by` et fiches de type `component` dont le champ `paths` correspond aux fichiers modifiés.

**Critères d'acceptation :**
- [ ] `graph/impact?pr=owner/repo#N` retourne les fiches avec la raison (`tracked_by` ou `paths`).
- [ ] Commentaire optionnel posté sur la PR avec cette liste.

**Dépendances :** FR-008, FR-016

---

### Domaine E : RAG

### FR-019 : Questions-réponses avec citations obligatoires

**Priorité :** Must Have

**Description :**
L'outil `ask` répond à une question en langage naturel à partir des chunks du vault. Chaque affirmation cite au moins une fiche avec heading et commit. Sans source pertinente, la réponse est « aucune source trouvée ».

**Critères d'acceptation :**
- [ ] Réponse structurée : texte + liste de citations `{note, heading, commit, score}`.
- [ ] Jeu d'évaluation de 30 questions, 100 % des réponses avec citation valide.
- [ ] Filtres `type`, `status`, espace appliqués à la récupération.

**Dépendances :** FR-007

### FR-020 : Fournisseur IA interchangeable

**Priorité :** Must Have

**Description :**
Modèles de génération et d'embedding configurables (Anthropic, OpenAI-compatible, Ollama local). Changer de fournisseur d'embedding déclenche une réindexation.

**Critères d'acceptation :**
- [ ] Configuration par variables d'environnement, sans rebuild.
- [ ] Mode 100 % local (Ollama) fonctionnel.

**Dépendances :** FR-006, FR-019

---

### Domaine F : UI web

### FR-021 : Lecture et navigation

**Priorité :** Must Have

**Description :**
UI Next.js (App Router) avec composants ObsidianUI. Rendu markdown, wikilinks cliquables, panneau latéral avec métadonnées, liens entrants et sortants groupés par type, nœuds GitHub liés avec état.

**Critères d'acceptation :**
- [ ] Toute fiche est accessible par URL stable `/n/<slug>`.
- [ ] Les liens typés sont affichés avec leur type.
- [ ] Rendu Mermaid et blocs de code.

**Dépendances :** FR-010, FR-016

### FR-022 : Recherche et filtres

**Priorité :** Must Have

**Description :**
Palette de recherche (`Cmd+K`) avec résultats hybrides et filtres `type`, `status`, `tags`, espace.

**Critères d'acceptation :**
- [ ] Résultats affichés en moins de 500 ms perçus.
- [ ] Navigation clavier complète.

**Dépendances :** FR-007

### FR-023 : Vue graphe interactive

**Priorité :** Must Have

**Description :**
Graphe local (fiche + voisins à profondeur N) et graphe global, filtrables par type de lien, type de fiche, statut. Clic = navigation.

**Critères d'acceptation :**
- [ ] Graphe local fluide jusqu'à 200 nœuds affichés.
- [ ] Couleur par type de fiche, style d'arête par type de lien.

**Dépendances :** FR-008

### FR-024 : Édition markdown avec commit

**Priorité :** Must Have

**Description :**
Éditeur markdown (texte brut avec prévisualisation, autocomplétion des wikilinks et des types de liens). Sauvegarde = commit sur `main` ou sur une branche de proposition selon le rôle et le statut.

**Critères d'acceptation :**
- [ ] Autocomplétion `[[` propose les fiches existantes.
- [ ] Sauvegarde affiche le SHA du commit.
- [ ] Conflit git détecté et affiché, jamais écrasé silencieusement.

**Dépendances :** FR-010, FR-014

### FR-025 : Actions depuis la fiche

**Priorité :** Must Have

**Description :**
Depuis une fiche : changer le statut, créer une issue GitHub, poser une question RAG dans le contexte de la fiche, voir le journal d'audit de la fiche.

**Critères d'acceptation :**
- [ ] « Créer une issue » ouvre un formulaire pré-rempli et lie la fiche.
- [ ] « Demander » utilise la fiche et son sous-graphe comme filtre de récupération.

**Dépendances :** FR-017, FR-019, FR-013

### FR-026 : Historique de fiche

**Priorité :** Should Have

**Description :**
Liste des commits d'une fiche avec diff lisible côte à côte.

**Critères d'acceptation :**
- [ ] Diff rendu en moins de 1 seconde pour 50 commits.

**Dépendances :** FR-001

---

### Domaine G : déploiement

### FR-027 : Installation en une commande

**Priorité :** Must Have

**Description :**
`docker compose up` démarre serveur, UI et base. Mode local : `npx defluance serve <vault>` avec SQLite, sans Docker.

**Critères d'acceptation :**
- [ ] Vault existant → UI accessible en moins de 10 minutes, doc incluse.
- [ ] Mode SQLite et mode Postgres testés en CI.

**Dépendances :** FR-010, FR-021

---

## Exigences non fonctionnelles

### NFR-001 : Performance - recherche et API

**Priorité :** Must Have

**Description :**
Recherche hybride < 300 ms (p95) et lecture de fiche < 100 ms (p95) sur un vault de 10 000 fiches, serveur 2 vCPU / 4 Go.

**Critères d'acceptation :**
- [ ] Benchmark reproductible dans le dépôt.

**Justification :** usage interactif et appels MCP fréquents par les agents.

### NFR-002 : Performance - indexation

**Priorité :** Must Have

**Description :**
Indexation complète de 10 000 fiches en moins de 10 minutes avec embeddings locaux ; indexation incrémentale d'un commit en moins de 5 secondes.

**Critères d'acceptation :**
- [ ] Mesuré en CI sur un vault synthétique.

**Justification :** l'index doit suivre le rythme des commits.

### NFR-003 : Sécurité

**Priorité :** Must Have

**Description :**
Secrets uniquement en variables d'environnement. Tokens hachés en base. Webhooks GitHub vérifiés par signature. Rate limiting par token. Aucune exécution de code issu du vault.

**Critères d'acceptation :**
- [ ] Webhook sans signature valide rejeté en 401.
- [ ] Scan dépendances en CI sans vulnérabilité critique.

**Justification :** les agents écrivent dans le vault et créent des issues ; la surface d'attaque est réelle.

### NFR-004 : Zéro lock-in

**Priorité :** Must Have

**Description :**
Le vault reste utilisable sans Defluance. Le format de fiche et de lien est une spec publique versionnée. Export complet = le dépôt git.

**Critères d'acceptation :**
- [ ] Test automatisé : ouvrir le vault de test avec le parser markdown d'Obsidian-compatible sans erreur.

**Justification :** promesse centrale du produit.

### NFR-005 : Fiabilité

**Priorité :** Should Have

**Description :**
Index reconstructible à tout moment. Aucune perte d'écriture : une sauvegarde est confirmée seulement après commit. Reprise des webhooks manqués par resynchronisation.

**Critères d'acceptation :**
- [ ] Crash pendant indexation → reprise sans corruption.

**Justification :** git est la seule source ; l'index est jetable.

### NFR-006 : Accessibilité et compatibilité navigateur

**Priorité :** Should Have

**Description :**
WCAG 2.1 AA sur les parcours lecture, recherche, édition. Navigateurs evergreen (Chrome, Firefox, Safari, Edge) 2 dernières versions. Thème sombre et clair.

**Critères d'acceptation :**
- [ ] Audit axe sans erreur critique.
- [ ] Les animations ObsidianUI respectent `prefers-reduced-motion`.

**Justification :** outil quotidien d'équipe.

### NFR-007 : Maintenabilité

**Priorité :** Must Have

**Description :**
TypeScript strict. Tests unitaires sur parser, indexeur, graphe, auth. Tests d'intégration API et MCP. Couverture ≥ 70 % sur le cœur (parser, graphe, auth).

**Critères d'acceptation :**
- [ ] CI verte requise pour merge.

**Justification :** projet source-available avec contributeurs externes (CLA requis).

### NFR-008 : Compatibilité et standards

**Priorité :** Must Have

**Description :**
Markdown CommonMark + GFM + wikilinks Obsidian. OpenAPI 3.1. MCP spec courante. Embeddings et génération via interface provider.

**Critères d'acceptation :**
- [ ] Suite de conformité wikilinks sur un vault Obsidian de référence.

**Justification :** interopérabilité humains, Obsidian, agents.

### NFR-009 : Internationalisation

**Priorité :** Could Have

**Description :**
UI en anglais par défaut, français fourni. Contenu du vault libre.

**Critères d'acceptation :**
- [ ] Chaînes UI externalisées.

**Justification :** équipe initiale francophone, cible internationale.

### NFR-010 : Observabilité

**Priorité :** Should Have

**Description :**
Logs structurés JSON, métriques (latence API, taille index, webhooks reçus, appels MCP par outil), endpoint `/health`.

**Critères d'acceptation :**
- [ ] Dashboard minimal documenté.

**Justification :** self-hosting par des équipes variées.

---

## Epics

### EPIC-001 : Format de vault et schéma

**Description :**
Définir et outiller le format de fiche, les liens typés, les templates et la validation CLI. Livrable : spec publique + `defluance validate` + `defluance new`.

**Exigences fonctionnelles :** FR-001, FR-002, FR-003, FR-004, FR-005

**Estimation stories :** 5

**Priorité :** Must Have

**Valeur business :** fondation de tout le reste et garantie zéro lock-in.

### EPIC-002 : Indexation et graphe

**Description :**
Indexeur reconstructible (plein texte, embeddings, arêtes), recherche hybride, requêtes de graphe, statut dérivé des événements.

**Exigences fonctionnelles :** FR-006, FR-007, FR-008, FR-009

**Estimation stories :** 6

**Priorité :** Must Have

**Valeur business :** rend le vault interrogeable et le graphe exploitable par l'IA.

### EPIC-003 : API, MCP et sécurité

**Description :**
API REST OpenAPI, serveur MCP, auth OAuth GitHub, tokens scopés, espaces, journal d'audit.

**Exigences fonctionnelles :** FR-010, FR-011, FR-012, FR-013, FR-014

**Estimation stories :** 7

**Priorité :** Must Have

**Valeur business :** façade unique pour humains et agents ; contrôle des actions IA.

### EPIC-004 : Connecteur GitHub

**Description :**
GitHub App, webhooks, cache, nœuds issue/PR, création d'issue depuis une fiche, analyse d'impact.

**Exigences fonctionnelles :** FR-015, FR-016, FR-017, FR-018

**Estimation stories :** 6

**Priorité :** Must Have

**Valeur business :** ferme la boucle spec → code et remplace le couplage Jira.

### EPIC-005 : RAG citant

**Description :**
Outil `ask` avec citations obligatoires, fournisseur IA interchangeable, jeu d'évaluation.

**Exigences fonctionnelles :** FR-019, FR-020

**Estimation stories :** 4

**Priorité :** Must Have

**Valeur business :** confiance et onboarding.

### EPIC-006 : UI web

**Description :**
Application Next.js avec ObsidianUI : lecture, recherche, graphe, édition avec commit, actions depuis la fiche, historique.

**Exigences fonctionnelles :** FR-021, FR-022, FR-023, FR-024, FR-025, FR-026

**Estimation stories :** 9

**Priorité :** Must Have

**Valeur business :** adoption par les PM et devs qui n'utilisent pas Obsidian.

### EPIC-007 : Déploiement et distribution

**Description :**
Docker Compose, mode local SQLite, Postgres, doc d'installation, release 0.1, observabilité.

**Exigences fonctionnelles :** FR-027 ; NFR-005, NFR-010

**Estimation stories :** 4

**Priorité :** Must Have

**Valeur business :** condition de l'adoption (perso gratuit, licence payante en entreprise).

---

## User stories (haut niveau)

- En tant que PM, je veux rédiger une spec fonctionnelle depuis un template et la lier à un composant afin que l'équipe et les agents sachent ce qu'elle impacte.
- En tant que PM, je veux créer une issue GitHub depuis ma spec afin de lancer le travail sans quitter l'outil.
- En tant que dev, je veux voir les specs impactées par ma PR afin de mettre la doc à jour avant merge.
- En tant que dev, je veux que ma spec passe à `implemented` quand la PR est mergée afin de ne pas maintenir le statut à la main.
- En tant qu'agent IA (Claude Code), je veux chercher la spec pertinente et lire ses dépendances via MCP afin de coder avec le bon contexte.
- En tant qu'agent IA, je veux créer un draft de spec sur une branche afin qu'un humain le valide.
- En tant que nouvel arrivant, je veux poser une question et obtenir une réponse citant les fiches afin de vérifier moi-même.
- En tant qu'admin, je veux des tokens d'agent limités à un espace et en lecture seule afin de contrôler ce que l'IA peut faire.
- En tant qu'utilisateur Obsidian, je veux continuer à éditer le vault dans Obsidian afin de ne pas changer d'outil.

Stories détaillées en phase 4 (sprint planning).

---

## Personas

- **Nadia, product manager** : écrit des specs, pas à l'aise avec git en ligne de commande, veut une UI claire et des actions en un clic.
- **Karim, développeur senior** : vit dans VS Code et Claude Code, veut que la doc soit dans le dépôt et accessible via MCP.
- **Agent Claude Code** : lit, cherche, lie, propose. Doit être limité et audité.
- **Léa, nouvelle recrue** : pose des questions, lit, ne modifie pas encore.

---

## Parcours utilisateurs

1. **Spec → issue → PR → implémenté** : Nadia crée une spec depuis un template, la lie à un composant, la passe en `approved`, crée une issue. Karim lance Claude Code qui lit la spec via MCP et ouvre une PR référençant l'issue. Merge → la spec passe à `implemented`, Nadia le voit sur la fiche.
2. **Question avec sources** : Léa ouvre la palette, pose « comment fonctionne la facturation ? », reçoit une réponse avec 3 citations, clique, lit la spec et son graphe local.
3. **Impact d'une PR** : Karim ouvre une PR, Defluance commente la liste des specs impactées ; Karim met à jour la spec technique dans la même PR (vault dans `docs/` du dépôt).

---

## Dépendances

### Internes

- Spec du format de vault (EPIC-001) avant tout le reste.
- API (EPIC-003) avant UI (EPIC-006).
- Connecteur GitHub (EPIC-004) avant statut dérivé (FR-009) et actions depuis la fiche (FR-025).

### Externes

- GitHub : GitHub Apps, webhooks, API REST, OAuth.
- MCP SDK TypeScript.
- Fournisseurs IA : Anthropic, OpenAI-compatible, Ollama.
- ObsidianUI : composants React/Tailwind/Motion copiés dans le dépôt (pas de dépendance npm), Next.js App Router.
- SQLite + sqlite-vec, Postgres + pgvector.

---

## Hypothèses

- Les équipes cibles utilisent GitHub et acceptent git comme mécanisme d'édition.
- La collaboration asynchrone (branches, PR sur les specs) suffit pour le MVP.
- ObsidianUI fournit assez de composants de base ; les composants manquants (éditeur, graphe, tableaux) sont construits ou pris ailleurs (ex. CodeMirror, Sigma.js ou react-force-graph).
- Les embeddings locaux sont suffisants pour des vaults < 10 000 fiches.

---

## Hors périmètre

- Édition collaborative temps réel (CRDT).
- Éditeur WYSIWYG.
- Neo4j (export optionnel plus tard).
- Multi-tenant / SaaS.
- Lancement d'agents de code depuis l'UI (v1.1).
- Connecteurs GitLab, Jira, Linear.
- Permissions par paragraphe.

---

## Questions ouvertes

1. Licence : tranchée le 2026-10-03, PolyForm Noncommercial 1.0.0 + licence commerciale payante (LICENSE, COMMERCIAL.md). Reste à définir : tarif, contact, contributor agreement (CLA) pour pouvoir relicencier.
2. Le vault par défaut vit-il dans le dépôt de code (`docs/`) ou dans un dépôt dédié ? Les deux sont supportés, lequel est documenté en premier ?
3. Commits des agents : branche + PR systématique, ou commit direct sur `main` autorisé pour les fiches `draft` ?
4. Bibliothèque de graphe pour l'UI : Sigma.js, react-force-graph ou D3 ?
5. Éditeur : CodeMirror 6 (markdown) retenu par défaut ?

---

## Approbation

### Parties prenantes

- **clement (fondateur, product et tech lead)** : influence élevée.
- **Équipes pilotes** : influence moyenne.
- **Communauté (usage personnel, contributeurs)** : influence moyenne à terme.

### Statut d'approbation

- [x] Product Owner (brief validé le 2026-10-02)
- [ ] Engineering Lead
- [ ] Design Lead
- [ ] QA Lead

---

## Historique des révisions

| Version | Date | Auteur | Changements |
|---------|------|--------|-------------|
| 1.0 | 2026-10-02 | clement | PRD initial |

---

## Prochaines étapes

### Phase 3 : architecture

`/bmad:architecture` : stack, modèle de données, API, composants, réponse aux NFR.

### Phase 4 : sprint planning

`/bmad:sprint-planning` : découpage des 7 epics en stories.

---

**Document créé avec BMAD Method v6 - Phase 2 (Planification)**

---

## Annexe A : matrice de traçabilité

| Epic | Nom | Exigences fonctionnelles | Stories (est.) |
|------|-----|--------------------------|----------------|
| EPIC-001 | Format de vault et schéma | FR-001, FR-002, FR-003, FR-004, FR-005 | 5 |
| EPIC-002 | Indexation et graphe | FR-006, FR-007, FR-008, FR-009 | 6 |
| EPIC-003 | API, MCP et sécurité | FR-010, FR-011, FR-012, FR-013, FR-014 | 7 |
| EPIC-004 | Connecteur GitHub | FR-015, FR-016, FR-017, FR-018 | 6 |
| EPIC-005 | RAG citant | FR-019, FR-020 | 4 |
| EPIC-006 | UI web | FR-021, FR-022, FR-023, FR-024, FR-025, FR-026 | 9 |
| EPIC-007 | Déploiement et distribution | FR-027, NFR-005, NFR-010 | 4 |

Total estimé : 41 stories.

---

## Annexe B : priorisation

| Catégorie | Must Have | Should Have | Could Have | Total |
|-----------|-----------|-------------|------------|-------|
| FR | 21 | 6 | 0 | 27 |
| NFR | 6 | 3 | 1 | 10 |

Should Have (livrables après le cœur du MVP si le temps manque) : FR-005 templates, FR-009 statut dérivé, FR-014 espaces, FR-018 impact PR, FR-026 historique, NFR-005, NFR-006, NFR-010.
