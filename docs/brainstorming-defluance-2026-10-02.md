---
type: note
status: approved
owner: clement
tags: [defluance, bmad]
links:
  - "[[product-brief-defluance-2026-10-02|related]]"
---

# Session de brainstorming : Defluance

**Date :** 2026-10-02
**Objectif :** Définir un outil open source type Confluence/Obsidian, collaboratif, où humains et IA rédigent, lient et exploitent des specs fonctionnelles et techniques, avec graphe de fiches, connecteur GitHub, API et RAG, pour piloter du développement assisté par IA.
**Contexte :** Projet greenfield. Confluence jugé excellent mais fermé, lourd, couplé à Jira, peu modulable. Obsidian jugé bon modèle mais non collaboratif et non open source. Cible : équipes produit et dev qui veulent écrire des specs et déclencher des modifications, PR et analyses depuis l'outil.
**Résultat attendu :** Vision claire, périmètre MVP, 5 à 7 insights structurants, liste d'idées priorisables pour le product brief.

## Techniques utilisées

1. **Starbursting** : questionner toutes les hypothèses (qui, quoi, où, quand, pourquoi, comment).
2. **SCAMPER** : générer des variantes créatives à partir de Confluence et Obsidian.
3. **Reverse brainstorming** : identifier les façons d'échouer, en déduire les garde-fous.

---

## Technique 1 : Starbursting

### Qui
- Product managers / product owners : rédigent specs fonctionnelles, critères d'acceptation.
- Développeurs / architectes : specs techniques, ADR (Architecture Decision Records), schémas.
- Agents IA (Claude Code, Copilot, agents maison) : lisent les specs, proposent des drafts, ouvrent des PR, mettent à jour les statuts.
- QA : lient tests et specs.
- Contributeurs open source : utilisent le vault comme doc projet.
- Nouveaux arrivants : onboarding via questions au RAG.

### Quoi
- Fiches typées : spec fonctionnelle, spec technique, ADR, note, glossaire, personne, composant, miroir d'issue, miroir de PR.
- Liens typés entre fiches : `implements`, `depends_on`, `supersedes`, `tested_by`, `tracked_by`, `blocks`, `related`.
- Index : recherche plein texte, recherche sémantique (embeddings), graphe navigable.
- Statuts de fiche : draft → review → approved → implemented → deprecated.
- API REST + serveur MCP (Model Context Protocol) pour les agents.
- Connecteur GitHub : issues, PR, états, labels, commits liés.

### Où
- Source de vérité : un dépôt git de fichiers markdown + frontmatter YAML (le "vault").
- Index dérivé : base locale (SQLite + sqlite-vec) ou Postgres + pgvector, reconstructible à tout moment.
- Hébergement : self-hosted (Docker), local-first possible (CLI seule), cloud optionnel plus tard.
- Pas de Neo4j en v1 : le graphe est une table d'arêtes dérivée des liens. Neo4j devient un export/adaptateur optionnel.

### Quand
- Rédaction de spec avant implémentation, puis mise à jour continue.
- Réindexation à chaque commit du vault (hook ou webhook).
- Sync GitHub en temps réel via webhooks, pas de polling.
- Statut de spec recalculé quand une PR liée est mergée.

### Pourquoi
- Confluence : fermé, lourd, couplé Jira, difficile à brancher sur une IA proprement.
- Obsidian : excellent modèle mental (markdown, wikilinks, graphe) mais mono-utilisateur et app non open source.
- Notion, Jira, Linear : fermés, données captives.
- Besoin nouveau : les agents IA deviennent des membres de l'équipe. Il faut un cerveau partagé lisible et modifiable par eux, avec traçabilité.

### Comment
- Markdown + frontmatter compatibles Obsidian dès le jour 1 (adoption sans friction).
- Web app légère qui consomme la même API que les agents.
- CLI pour indexer, valider le schéma, interroger.
- GitHub App pour les permissions et les webhooks.
- RAG avec citations obligatoires (fiche + version).
- Collaboration v1 via git (branches, PR sur les specs), temps réel CRDT en v2.

---

## Technique 2 : SCAMPER

### Substitute (remplacer)
- Pages Confluence en base propriétaire → fichiers markdown versionnés dans git.
- Lien Jira → issues et PR GitHub.
- Recherche propriétaire → embeddings locaux (sqlite-vec / pgvector), modèle d'embedding interchangeable.
- Éditeur WYSIWYG → markdown avec prévisualisation, éditeur riche plus tard.
- Base graphe dédiée → arêtes dérivées des liens, requêtes SQL ou Cypher-like simplifié.

### Combine (combiner)
- Wiki + graphe + miroir d'issues + lanceur d'agents dans un seul outil.
- Spec fonctionnelle + critères d'acceptation Gherkin dans la même fiche, exécutables par l'IA pour générer des tests.
- ADR + PR : chaque décision pointe vers la PR qui l'applique.
- Fiche + conversation : fil de commentaires / threads IA attachés à une section.
- Spec + "coverage" : quelle part d'une spec est implémentée (PR mergées liées).

### Adapt (adapter)
- Wikilinks Obsidian `[[fiche]]` + syntaxe de lien typé `[[fiche|implements]]`.
- Frontmatter typé façon Dendron schemas / Backstage `catalog-info.yaml`.
- `llms.txt` et export plain-text pour exposition IA.
- Docs-as-code : CI valide le schéma des fiches, liens cassés, fiches orphelines.
- Templates de fiches façon Obsidian Templater, versionnés dans le vault.

### Modify (modifier)
- Liens porteurs de sens : le graphe n'est utile que si les arêtes sont typées.
- Statut de fiche piloté par les événements GitHub (PR merge → `implemented`).
- Vue graphe filtrable par type de lien, type de fiche, statut, propriétaire.
- Historique de fiche = historique git, avec diff lisible dans l'UI.
- Permissions par espace et tokens d'agent à portée limitée (lecture seule, création de PR, etc.).

### Put to other uses (autres usages)
- Onboarding : "explique-moi le module paiement" via RAG citant les fiches.
- Changelog produit généré depuis les specs passées en `implemented`.
- Analyse d'impact : quelles specs sont touchées par cette PR / ce fichier ?
- Génération de tests ou de doc utilisateur depuis les specs.
- Audit et conformité : traçabilité exigence → décision → code → test.
- Base de connaissance pour support client.

### Eliminate (éliminer)
- Pas de format propriétaire : le vault reste lisible avec n'importe quel éditeur, zéro lock-in.
- Pas de Jira ni de tracker interne : GitHub est le tracker.
- Pas de hiérarchie d'espaces rigide : dossiers + tags + liens.
- Pas de WYSIWYG, pas de CRDT, pas de Neo4j, pas de multi-tenant en v1.
- Pas de permissions fines par paragraphe.

### Reverse (inverser)
- Au lieu de "humain écrit, IA lit" : l'IA rédige un draft de spec depuis une issue ou une discussion, l'humain valide.
- Au lieu de "wiki → code" uniquement : "code → wiki", l'agent met à jour la spec quand la PR merge.
- Au lieu d'une web app d'abord : API + MCP + CLI d'abord, UI web ensuite sur la même API.
- Au lieu de rechercher dans l'outil : l'outil est appelé depuis Claude Code / l'IDE via MCP.
- Au lieu de synchroniser GitHub vers l'outil : le vault peut vivre dans le dépôt de code lui-même (`docs/` ou dépôt dédié).

---

## Technique 3 : Reverse brainstorming

### Comment garantir l'échec
1. Réimplémenter Confluence et Obsidian en entier avant la première release.
2. Inventer un format de stockage propriétaire.
3. Ajouter l'IA en surcouche sur une UI pensée pour humains.
4. Démarrer par la collaboration temps réel CRDT.
5. Faire un graphe sans sémantique (juste des liens).
6. Faire un RAG qui répond sans citer ses sources.
7. Synchroniser GitHub par polling sans cache, avec quotas explosés.
8. Imposer un nouvel éditeur à des gens qui aiment Obsidian ou VS Code.
9. Ignorer les permissions, laisser un agent lire tout et écrire partout.
10. Laisser l'agent pousser du code directement sur `main`.
11. Lier l'outil à un seul fournisseur d'IA.
12. Ne pas définir de schéma de fiche, laisser chacun inventer ses champs.

### Garde-fous (inverse)
1. MVP strict : vault markdown + index + graphe typé + API/MCP + sync GitHub lecture.
2. Markdown + frontmatter YAML, compatibles Obsidian, documentés comme spec publique.
3. API-first : l'UI web n'est qu'un client parmi d'autres.
4. Collaboration v1 par git (branches, PR, revue). CRDT en v2 si demande réelle.
5. Vocabulaire de liens typés + schéma de fiches validé en CI.
6. RAG avec citations fiche + commit obligatoires, réponse refusée si aucune source.
7. GitHub App + webhooks + cache local des issues/PR.
8. Compatibilité Obsidian et édition dans l'IDE ; l'UI web est optionnelle.
9. Permissions par espace, tokens d'agent scopés, journal d'audit des actions IA.
10. Les actions d'agent produisent toujours des PR, jamais de push direct ; approbation humaine.
11. Fournisseur d'IA interchangeable (AI Gateway / abstraction provider), embeddings locaux possibles.
12. Schéma de fiche minimal obligatoire : `type`, `status`, `owner`, `links`.

---

## Idées consolidées par catégorie

### 1. Modèle de données et stockage
- Vault = dépôt git de markdown + frontmatter YAML, source de vérité unique.
- Index dérivé (SQLite + sqlite-vec en local, Postgres + pgvector en serveur), reconstructible.
- Types de fiche : spec fonctionnelle, spec technique, ADR, note, glossaire, composant, personne, issue-mirror, pr-mirror.
- Schéma minimal : `type`, `status`, `owner`, `links`, `tags`. Schémas étendus par type, validés en CI.
- Templates de fiches versionnés dans le vault.
- Historique = git ; diff de fiche lisible dans l'UI.

### 2. Graphe et liens
- Liens typés : `implements`, `depends_on`, `supersedes`, `tested_by`, `tracked_by`, `blocks`, `related`.
- Syntaxe `[[fiche|type]]` compatible Obsidian (Obsidian l'affiche comme alias).
- Vue graphe filtrable par type de lien, de fiche, statut.
- Requêtes de graphe simples via API (voisins, chemins, impact).
- Détection de fiches orphelines et liens cassés.
- Export Neo4j / GraphML optionnel.

### 3. Intégration GitHub
- GitHub App : webhooks issues, PR, commits, labels.
- Issues et PR deviennent des nœuds du graphe (fiches miroir en lecture).
- Création d'issue depuis une fiche, lien automatique `tracked_by`.
- Statut de spec recalculé à la merge d'une PR liée.
- Analyse d'impact : fichiers touchés par une PR → specs liées.
- Vault hébergeable dans le dépôt de code (`docs/`) ou dépôt dédié.

### 4. Interface IA : API, MCP, RAG
- API REST documentée (OpenAPI) : CRUD fiches, liens, recherche, graphe.
- Serveur MCP exposant les mêmes capacités (outils : search, read, link, create_draft, open_issue).
- RAG avec chunks ancrés à fiche + commit, citations obligatoires.
- Fournisseur d'IA interchangeable ; embeddings locaux possibles.
- `llms.txt` et export plain-text du vault.
- Tokens d'agent scopés, journal d'audit.

### 5. Collaboration et édition
- V1 : édition via git (branches, PR, revue), UI web d'édition simple en markdown.
- Compatibilité Obsidian et IDE : aucun verrouillage d'éditeur.
- Commentaires / threads attachés à une section, humains et IA.
- V2 : édition temps réel CRDT (Yjs) si besoin avéré.
- Permissions par espace.

### 6. Workflows produit → code
- "Lancer depuis une fiche" : créer issue, lancer agent, suivre la PR.
- IA rédige un draft de spec depuis une issue ou une discussion ; humain valide.
- Agent met à jour la spec à la merge de la PR (code → wiki).
- Génération de tests, doc utilisateur, changelog depuis les specs.
- Actions d'agent = PR uniquement, approbation humaine.

### 7. Distribution et adoption
- Open source (licence permissive type Apache-2.0 ou AGPL à décider).
- Docker Compose pour le self-hosting, CLI installable seule.
- Démarrage sur un vault Obsidian existant sans migration.
- Positionnement : "second cerveau d'équipe pour le développement assisté par IA".

### 8. Risques identifiés
- Scope creep : réimplémenter Confluence + Obsidian.
- Collaboration temps réel coûteuse, à différer.
- Hallucinations RAG sans citations.
- Quotas GitHub, sync fragile.
- Concurrence : Outline, Docmost, AFFiNE, AppFlowy, Logseq, Foam, Dendron, SilverBullet, Backstage TechDocs. Aucun ne combine graphe typé + GitHub + MCP + RAG citant.

---

## Insights clés

### Insight 1 : Le vault git markdown est la source de vérité, la base est un index dérivé
**Description :** Fichiers markdown + frontmatter dans git. L'index (plein texte, embeddings, arêtes du graphe) est reconstruit à partir des fichiers.
**Source :** Starbursting (où), SCAMPER (substitute, eliminate), Reverse (garde-fous 2, 8).
**Impact :** Élevé
**Effort :** Faible
**Pourquoi ça compte :** Zéro lock-in, compatibilité Obsidian et IDE immédiate, revue et historique gratuits via git, le vault peut vivre dans le dépôt de code.

### Insight 2 : Des liens typés et un schéma de fiche, pas une base graphe
**Description :** Le "Neo4j-like" se réalise avec un vocabulaire de types de liens et de fiches, validé en CI, stocké comme table d'arêtes.
**Source :** SCAMPER (modify), Reverse (garde-fous 5, 12).
**Impact :** Élevé
**Effort :** Moyen
**Pourquoi ça compte :** C'est la sémantique qui rend le graphe exploitable par l'IA (impact, dépendances, couverture), pas la technologie de stockage.

### Insight 3 : API-first et MCP-first, l'UI est un client
**Description :** L'API REST et le serveur MCP sont la façade principale. La web app, la CLI et les agents consomment la même API.
**Source :** Starbursting (comment), SCAMPER (reverse), Reverse (garde-fou 3).
**Impact :** Élevé
**Effort :** Moyen
**Pourquoi ça compte :** Répond à "autant utilisable par un humain que par une IA". Évite l'IA en surcouche.

### Insight 4 : GitHub est le tracker, ses objets sont des nœuds du graphe
**Description :** Issues et PR entrent dans le graphe via GitHub App et webhooks. Les statuts de spec suivent les événements GitHub.
**Source :** Starbursting (quoi, quand), SCAMPER (substitute, combine), Reverse (garde-fou 7).
**Impact :** Élevé
**Effort :** Moyen
**Pourquoi ça compte :** Remplace le couplage Jira de Confluence par un couplage ouvert, et ferme la boucle spec → code.

### Insight 5 : Boucle fermée spec → issue → PR → statut
**Description :** Depuis une fiche, on crée une issue, on lance un agent, on suit la PR, et le statut de la spec se met à jour à la merge. L'agent peut aussi mettre à jour la spec.
**Source :** SCAMPER (combine, reverse, put to other uses), Reverse (garde-fou 10).
**Impact :** Élevé
**Effort :** Élevé
**Pourquoi ça compte :** C'est le différenciateur : les équipes produit pilotent des modifications depuis les specs. Les actions d'agent restent des PR avec approbation humaine.

### Insight 6 : RAG citant, ancré à fiche et version
**Description :** Chaque réponse cite les fiches et le commit utilisés. Pas de source, pas de réponse.
**Source :** SCAMPER (put to other uses), Reverse (garde-fou 6).
**Impact :** Moyen
**Effort :** Moyen
**Pourquoi ça compte :** Confiance des équipes, onboarding, traçabilité des décisions.

### Insight 7 : Collaboration par git en v1, temps réel en v2
**Description :** Branches et PR sur les specs couvrent la revue et la collaboration asynchrone. Le CRDT attend une demande réelle.
**Source :** Starbursting (comment), SCAMPER (eliminate), Reverse (garde-fou 4).
**Impact :** Moyen
**Effort :** Faible (v1)
**Pourquoi ça compte :** Réduit le périmètre MVP de moitié sans perdre la promesse "collaboratif".

---

## Périmètre MVP proposé

1. Vault markdown + frontmatter, schéma de fiches et de liens typés, validation CLI.
2. Indexeur : plein texte + embeddings + table d'arêtes, reconstructible.
3. API REST + serveur MCP : search, read, graph (voisins, impact), create_draft, link.
4. Connecteur GitHub lecture : issues et PR en nœuds, statut de spec à la merge.
5. UI web minimale : lecture, recherche, graphe, édition markdown via commit.
6. RAG citant via l'API.

Hors MVP : CRDT temps réel, WYSIWYG, Neo4j, multi-tenant, lancement d'agents (v1.1).

## Statistiques

- Idées générées : 68
- Catégories : 8
- Insights clés : 7
- Techniques appliquées : 3

## Prochaines étapes recommandées

1. `/bmad:product-brief` : formaliser vision, cible, différenciation, périmètre MVP.
2. `/bmad:research` : benchmark rapide Outline, Docmost, AFFiNE, SilverBullet, Foam, Backstage TechDocs.
3. `/bmad:prd` : exigences fonctionnelles à partir des 7 insights.
4. `/bmad:architecture` : vault git + index + API/MCP + GitHub App.

---

*Généré par BMAD Method v6 - Creative Intelligence*
*Durée de session : 30 minutes*
