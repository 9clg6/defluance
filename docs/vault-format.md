---
type: technical-spec
status: review
owner: clement
tags: [defluance, format]
links:
  - "[[architecture-defluance-2026-10-02|implements]]"
---

# Format du vault Defluance

Spec publique, version 0.1. Un vault est un dossier de fichiers `.md`, normalement un dépôt git. Tout ce que Defluance sait est dérivé de ces fichiers : on peut supprimer Defluance sans rien perdre, et ouvrir le vault dans Obsidian ou un IDE.

## Organisation

- Une fiche = un fichier `.md`. Son **id** est son chemin relatif sans `.md` (`specs/auth-login`).
- Les dossiers dont le nom commence par `.` (`.git`, `.obsidian`, `.defluance`) et `node_modules` sont ignorés.
- `.defluance/schema.yaml` et `.defluance/templates/<nom>.md` (voir « Templates ») configurent le vault. Les deux sont optionnels, des valeurs par défaut existent.
- Un dossier racine peut servir d'espace (permissions, voir l'architecture).

## Templates

`defluance new <type> "Titre"` et **New note** créent une fiche à partir d'un template : `.defluance/templates/<nom>.md`, ou, à défaut, le template intégré du type (`functional-spec`, `technical-spec`, `adr`, `note`, `glossary`, `component`). Un fichier du vault qui porte le nom d'un template intégré le remplace ; le supprimer rend le template intégré. Un nom s'écrit en minuscules, chiffres et tirets (`rfc`, `post-mortem`), 40 caractères au plus, et le fichier ne dépasse pas 20 Ko.

```markdown
---
type: {{type}}
status: draft
owner: {{owner}}
---

# {{title}}

## Contexte
<!-- ai: pourquoi maintenant, en deux phrases, sans jargon -->

## Décision
<!-- ai: une décision claire, les alternatives écartées vont dans « Conséquences » -->

## Conséquences
```

- Variables : `{{type}}`, `{{title}}`, `{{owner}}`.
- Un template doit produire une fiche lisible : le frontmatter définit `type`, `status` et `owner`.
- **Indications pour le modèle** : un commentaire HTML `<!-- ai: consigne -->` est une instruction pour le modèle de langage qui rédige la fiche (bouton « Rédiger » de l'éditeur, `POST /api/v1/notes/{id}/generate`). Il est **retiré**, avec sa ligne, quand une fiche est créée à la main : il n'apparaît jamais dans le vault. Le modèle, lui, reçoit le template tel qu'il est écrit.
- Gestion par l'API (administrateurs uniquement, jamais les agents) : `GET /api/v1/templates` (`source` : `builtin`, `vault` ou `override`), `PUT /api/v1/templates/{nom}` avec `{ "content": "…" }`, `DELETE /api/v1/templates/{nom}`. Chaque écriture est un commit `template: <nom>`.

## Frontmatter

```yaml
---
type: functional-spec        # obligatoire
status: draft                # obligatoire
owner: clement               # obligatoire
tags: [auth, v1]             # optionnel, liste de chaînes
aliases: [Connexion]         # optionnel, compatible Obsidian
acceptance_criteria: []      # exigé par le type functional-spec
links:                       # optionnel, liens déclarés hors du corps
  - "[[auth-login|implements]]"
  - { to: auth-login, type: implements }
---
```

Une fiche sans `type`, `status` ou `owner` est lue et indexée, mais `defluance validate` la signale en erreur.

## Types de fiche

| Type | Champs en plus | Usage |
|------|----------------|-------|
| `functional-spec` | `acceptance_criteria` | spec fonctionnelle |
| `technical-spec` | | spec technique |
| `adr` | | décision d'architecture |
| `note` | | note libre |
| `glossary` | | définition |
| `component` | `paths` | composant du code, sert à l'analyse d'impact |
| `issue`, `pull-request` | | miroirs GitHub, jamais écrits à la main |

`schema.yaml` peut ajouter ou redéfinir des types (`types:`), remplacer la liste des statuts (`statuses:`) et des types de lien (`link_types:`).

## Statuts

`draft` → `review` → `approved` → `implemented` → `deprecated`.

## Liens

Syntaxe wikilink Obsidian, avec un type optionnel à la place de l'alias : `[[cible|type]]`.

| Écriture | Sens |
|----------|------|
| `[[auth-login]]` | lien `related` |
| `[[auth-login\|implements]]` | lien typé |
| `[[auth-login#Flux\|blocks]]` | vers un titre de la fiche |
| `[[auth-login\|cliquez ici]]` | alias d'affichage Obsidian, lien `related` (avertissement) |
| `[[gh:owner/repo#12\|tracked_by]]` | issue ou PR GitHub, `#` n'est pas un titre ici |
| `![[autre-fiche]]` | transclusion, comptée comme lien `related` |
| `![[schema.png]]` | pièce jointe, ignorée |

Types de lien par défaut : `implements`, `depends_on`, `supersedes`, `tested_by`, `tracked_by`, `blocks`, `related`.

**Résolution** (comme Obsidian, sans tenir compte de la casse) : chemin complet, puis nom de fichier le plus court, puis `aliases`. Si plusieurs fiches portent le même nom, la plus proche de la racine gagne et un avertissement est émis.

**Ignorés** : liens dans les blocs de code et le code en ligne, liens vers une ancre de la même fiche (`[[#titre]]`).

Dans `links:` du frontmatter, la forme objet `{ to, type }` est stricte : un type inconnu est une erreur. Dans le corps, un alias inconnu est supposé être un alias d'affichage Obsidian et ne produit qu'un avertissement.

## Syntaxe Obsidian

Ce que vous écrivez dans Obsidian s'affiche dans Defluance, sans conversion.

| Écrit | Résultat |
|---|---|
| `![[attachments/schema.png]]`, `![[schema.png\|300]]` | image (largeur facultative) ; audio et vidéo s'affichent avec leur lecteur ; un PDF devient un lien |
| `![[Autre fiche]]`, `![[Autre fiche#Titre]]` | la fiche, ou sa section, affichée à cet endroit (un seul niveau d'imbrication) |
| `> [!warning] Titre` | encadré ; `[!note]`, `tip`, `warning`, `danger`, `question`, `example`, `quote`… ; `[!tip]-` le replie |
| `==texte==` | surlignage |
| `#tag`, `#a/b` | étiquette : indexée comme celles du frontmatter, filtrable |
| `![alt](chemin.png)` | image relative à la fiche |

Les pièces jointes vivent dans le vault, dans le dossier `attachments/` à côté de la fiche. On les ajoute en collant ou en déposant un fichier dans l'éditeur (`POST /api/v1/files`) : png, jpg, gif, webp et pdf, jusqu'à 10 Mo (le contenu est vérifié, pas seulement l'extension). Le nom reçoit un court condensé du contenu (le même fichier n'est stocké qu'une fois). Des svg, audio et vidéo ajoutés par git s'affichent aussi. Elles se lisent avec le droit de lecture sur l'espace de la fiche. Un SVG est servi dans un bac à sable : il ne peut pas exécuter de script.

## Règles de `defluance validate`

| Règle | Niveau |
|-------|--------|
| `frontmatter-invalid`, `missing-field`, `unknown-type`, `invalid-status`, `invalid-tags` | erreur |
| `broken-link` (cible introuvable, hors `gh:`) | erreur |
| `unknown-link-type` | erreur en frontmatter objet, avertissement dans le corps |
| `broken-heading`, `ambiguous-link`, `orphan` | avertissement |

Code de sortie 1 s'il y a au moins une erreur.
