---
type: note
status: approved
owner: clement
tags: [defluance, bmad]
links:
  - "[[brainstorming-defluance-2026-10-02|related]]"
---

# Product Brief : Defluance

**Date :** 2026-10-02
**Auteur :** clement
**Version :** 1.0
**Type de projet :** web-app
**Niveau de projet :** 3
**Source :** docs/brainstorming-defluance-2026-10-02.md

> Les sections marquées `[hypothèse]` ont été remplies sans interview. À valider ou corriger.

---

## Résumé exécutif

Defluance est un second cerveau d'équipe source-available pour le développement logiciel assisté par IA. Les équipes produit et dev y rédigent des specs fonctionnelles et techniques sous forme de fiches markdown liées entre elles par un graphe typé, synchronisées avec GitHub (issues, PR, états), et exposées aux humains via une UI web et aux agents IA via une API et un serveur MCP (Model Context Protocol). L'objectif : qu'une équipe produit puisse écrire une spec et, depuis la fiche, déclencher issues, analyses et PR, avec un RAG qui cite ses sources.

---

## Énoncé du problème

### Le problème

Les outils actuels séparent la connaissance (Confluence, Notion, Obsidian) du code et du tracking (GitHub, Jira), et aucun n'est pensé pour que des agents IA lisent, lient et modifient la connaissance de façon traçable.

- Confluence : excellent fonctionnellement, mais fermé, lourd, couplé à Jira, difficile à brancher sur une IA de façon propre.
- Obsidian : bon modèle mental (markdown, wikilinks, graphe), mais mono-utilisateur, application non open source.
- Notion, Jira, Linear : données captives, API limitées pour un usage agentique.
- Résultat : specs obsolètes dès la PR mergée, contexte dispersé, agents IA sans source de vérité fiable, équipes produit dépendantes des devs pour toute action sur le code.

### Pourquoi maintenant

Les agents de code (Claude Code, Copilot, agents maison) sont devenus des membres de l'équipe. Ils ont besoin d'un contexte structuré, versionné et interrogeable. MCP est devenu le standard d'exposition d'outils aux agents. Les bases vectorielles embarquées (sqlite-vec, pgvector) rendent le RAG trivial à auto-héberger. `[hypothèse]`

### Impact si non résolu

- Specs et code divergent, dette documentaire permanente.
- Chaque équipe bricole son propre pont IA ↔ wiki ↔ GitHub.
- Les agents hallucinent faute de source de vérité citée.
- Dépendance à des éditeurs fermés pour un actif stratégique : la connaissance produit.

---

## Public cible

### Utilisateurs primaires

- **Product managers / product owners** : rédigent specs fonctionnelles et critères d'acceptation, veulent déclencher des actions sans passer par un ticket.
- **Développeurs et architectes** : rédigent specs techniques et ADR (Architecture Decision Records), veulent que la doc suive le code.
- **Agents IA** : consomment l'API et le MCP pour lire, chercher, lier, proposer des drafts, ouvrir des issues et PR.

Profil : équipes tech de 3 à 30 personnes, à l'aise avec markdown et git, déjà utilisatrices de GitHub. `[hypothèse]`

### Utilisateurs secondaires

- QA : lient tests et specs.
- Nouveaux arrivants : onboarding via questions au RAG.
- Support et contributeurs externes : lecture seule.

### Besoins utilisateurs

1. Une source de vérité unique, versionnée, lisible par humains et IA, sans lock-in.
2. Des liens porteurs de sens entre specs, décisions, issues, PR et tests, pour l'analyse d'impact et la couverture.
3. Une boucle fermée spec → issue → PR → statut, pilotable depuis la fiche.

---

## Vue d'ensemble de la solution

### Solution proposée

Un vault git de fichiers markdown + frontmatter YAML, compatible Obsidian, est la source de vérité. Un indexeur en dérive un index plein texte, des embeddings et une table d'arêtes typées. Une API REST et un serveur MCP exposent recherche, lecture, graphe et création de drafts. Une GitHub App synchronise issues et PR comme nœuds du graphe et met à jour les statuts de specs. Une UI web légère consomme la même API.

### Fonctionnalités clés

- Fiches typées (spec fonctionnelle, spec technique, ADR, note, glossaire, composant, miroir issue/PR) avec schéma minimal : `type`, `status`, `owner`, `links`, `tags`.
- Liens typés `[[fiche|type]]` : `implements`, `depends_on`, `supersedes`, `tested_by`, `tracked_by`, `blocks`, `related`.
- Indexeur reconstructible : plein texte + embeddings + graphe.
- API REST (OpenAPI) et serveur MCP : search, read, graph (voisins, impact), create_draft, link, open_issue.
- Connecteur GitHub : webhooks issues/PR, statut de spec recalculé à la merge, analyse d'impact PR → specs.
- RAG citant fiche + commit, pas de réponse sans source.
- UI web : lecture, recherche, graphe filtrable, édition markdown via commit.
- CLI : indexation, validation de schéma, requêtes.
- Tokens d'agent scopés, journal d'audit des actions IA.

### Proposition de valeur

Confluence pour l'ergonomie des specs, Obsidian pour le modèle markdown + graphe, GitHub pour le tracking, le tout source-available (gratuit en usage personnel, licence payante en usage professionnel), auto-hébergeable, et nativement utilisable par des agents IA. Les actions des agents produisent des PR, jamais de push direct.

---

## Objectifs business

### Objectifs `[hypothèse]`

- Publier un MVP source-available utilisable sur un vault Obsidian existant d'ici 3 mois.
- Obtenir 5 équipes pilotes externes dans les 3 mois suivant la release.
- Devenir l'outil de référence « specs + agents IA » : 1 000 étoiles GitHub à 12 mois.

### Métriques de succès `[hypothèse]`

- Temps entre création de fiche et première issue liée.
- Part des specs `approved` ayant au moins une PR liée mergée (couverture).
- Taux de réponses RAG avec citation valide.
- Nombre d'appels MCP par semaine par équipe (usage agentique réel).
- Installations Docker / CLI, étoiles, contributeurs.

### Valeur business

Modèle : usage personnel et non commercial gratuit, licence payante pour tout usage professionnel ou commercial. La valeur est le revenu de licences, l'adoption par les particuliers qui prescrivent en entreprise, et une offre hébergée ensuite.

---

## Périmètre

### Dans le périmètre (MVP)

- Format de vault : markdown + frontmatter, schéma de fiches et de liens, documenté comme spec publique.
- CLI : init, validate, index, query.
- Indexeur : plein texte, embeddings (fournisseur interchangeable, local possible), table d'arêtes.
- API REST documentée + serveur MCP.
- Connecteur GitHub lecture (GitHub App, webhooks) : issues et PR en nœuds, statuts de spec.
- Création d'issue depuis une fiche.
- RAG citant.
- UI web minimale : lecture, recherche, graphe, édition markdown avec commit.
- Permissions par espace, tokens d'agent scopés, journal d'audit.
- Déploiement Docker Compose, stockage SQLite en local et Postgres en serveur.

### Hors périmètre (MVP)

- Édition collaborative temps réel (CRDT).
- Éditeur WYSIWYG.
- Base graphe dédiée (Neo4j) : export optionnel seulement.
- Multi-tenant / SaaS.
- Lancement d'agents de code depuis l'UI (v1.1).
- Connecteurs autres que GitHub (GitLab, Jira, Linear).
- Permissions fines par paragraphe.

### Évolutions envisagées

- v1.1 : « lancer depuis une fiche » : agent qui ouvre une PR, suivi dans la fiche ; agent qui met à jour la spec à la merge.
- v1.2 : génération de tests, doc utilisateur, changelog depuis les specs.
- v2 : CRDT temps réel, commentaires par section, GitLab, export Neo4j, offre hébergée.

---

## Parties prenantes `[hypothèse]`

- **clement (fondateur, product et tech lead)** : influence élevée. Vision, arbitrages, développement initial.
- **Équipes pilotes (PM et devs)** : influence moyenne. Retours d'usage, validation du format de vault.
- **Communauté (usage personnel, contributeurs)** : influence moyenne à terme. Contributions, connecteurs, adoption.
- **Fournisseurs IA et GitHub** : influence faible mais dépendance technique (API, quotas, MCP).

---

## Contraintes et hypothèses

### Contraintes

- Équipe initiale réduite (1 personne + agents IA) : périmètre MVP strict. `[hypothèse]`
- Licence : PolyForm Noncommercial 1.0.0 + licence commerciale payante. Tarif et contact à définir avant la 0.1.
- Auto-hébergeable : aucune dépendance à un service cloud spécifique ; fournisseur IA interchangeable.
- Compatibilité Obsidian non négociable : le vault doit rester lisible et éditable dans Obsidian et un IDE.
- Quotas API GitHub : webhooks + cache, pas de polling.

### Hypothèses

- Les équipes cibles utilisent déjà GitHub et acceptent markdown + git comme workflow d'édition.
- La collaboration asynchrone par branches/PR suffit pour le MVP.
- Un schéma de fiche minimal avec liens typés est accepté par les PM sans formation lourde.
- MCP reste le standard d'intégration des agents sur l'horizon du projet.
- Les embeddings locaux sont suffisants pour un RAG de qualité sur des vaults de taille équipe (< 10 000 fiches).

---

## Critères de succès

- Un vault Obsidian existant est indexé et interrogeable via MCP en moins de 10 minutes après installation.
- Un agent Claude Code peut, via MCP, trouver la spec pertinente, lire ses dépendances et créer une issue liée.
- Une PR mergée liée à une spec fait passer son statut à `implemented` sans intervention humaine.
- Chaque réponse RAG cite au moins une fiche avec son commit ; zéro réponse sans source.
- Au moins une équipe pilote utilise Defluance comme source de vérité des specs pendant 4 semaines consécutives.
- Le vault reste exploitable sans Defluance (aucun lock-in constaté).

---

## Calendrier et jalons `[hypothèse]`

### Lancement cible

MVP public : fin décembre 2026 (environ 12 semaines).

### Jalons

- S2 : spec du format de vault, schéma de fiches et liens, CLI validate.
- S4 : indexeur (plein texte, embeddings, graphe) + API REST.
- S6 : serveur MCP + RAG citant ; test avec Claude Code sur un vault réel.
- S8 : GitHub App, sync issues/PR, statuts de spec.
- S10 : UI web minimale (lecture, recherche, graphe, édition).
- S12 : Docker Compose, doc, release 0.1, premières équipes pilotes.

---

## Risques et mitigation

- **Risque :** scope creep, réimplémenter Confluence + Obsidian.
  - **Probabilité :** élevée
  - **Mitigation :** périmètre MVP figé dans ce brief, tout ajout passe par la liste « évolutions ».
- **Risque :** adoption faible car nouveau workflow imposé aux PM.
  - **Probabilité :** moyenne
  - **Mitigation :** compatibilité Obsidian et IDE, UI web d'édition simple, templates de fiches.
- **Risque :** RAG qui hallucine, perte de confiance.
  - **Probabilité :** moyenne
  - **Mitigation :** citations obligatoires fiche + commit, refus sans source, évaluation sur jeu de questions.
- **Risque :** sync GitHub fragile, quotas.
  - **Probabilité :** moyenne
  - **Mitigation :** GitHub App, webhooks, cache local, reconstruction à la demande.
- **Risque :** dépendance à un fournisseur IA.
  - **Probabilité :** faible
  - **Mitigation :** abstraction provider, embeddings locaux possibles.
- **Risque :** agent qui modifie code ou specs sans contrôle.
  - **Probabilité :** moyenne
  - **Mitigation :** actions d'agent = PR uniquement, tokens scopés, journal d'audit.
- **Risque :** concurrence (Outline, Docmost, AFFiNE, SilverBullet, Foam, Backstage TechDocs).
  - **Probabilité :** moyenne
  - **Mitigation :** différenciation nette : graphe typé + GitHub + MCP + RAG citant ; `/bmad:research` pour benchmark.

---

## Prochaines étapes

1. Valider les sections `[hypothèse]` de ce brief.
2. Créer le PRD : `/bmad:prd`.
3. Benchmark concurrents (optionnel) : `/bmad:research`.
4. Architecture : `/bmad:architecture`.

---

**Document créé avec BMAD Method v6 - Phase 1 (Analyse)**

*Pour continuer : `/bmad:workflow-status`.*
