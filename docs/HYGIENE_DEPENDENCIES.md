# Hygiène des dépendances

## État au 2026-08-15 (PR hygiène) — ✅ RÉSOLU : `npm audit` = 0 vulnérabilité

Les 6 HIGH ci-dessous ont été fermées **sans `--force`** et **sans upgrade majeur** :

- **`next` 16.2.11 → 16.3.1** (minor, `isSemVerMajor: false`) → ferme `next`,
  `postcss`, `sharp` (les 3 qui transitaient par Next). `eslint-config-next` aligné
  sur `16.3.1`.
- **`npm audit fix` (non-force)** → ferme `brace-expansion`, `js-yaml`, `nanoid`
  (bumps transitifs compatibles dans le lock ; aucun `overrides` nécessaire).

Vérifié : `npm audit` = **0 vulnérabilité** ; gates lint/typecheck/test (152)/build
tous PASS ; MapLibre / dnd-kit / settings / widget registry / route `/chantiers/carte`
intacts. Aucune dépendance ajoutée, React/MapLibre/dnd-kit inchangés.

Note runtime : aucune des 6 n'était exploitable côté app (toutes build/lint-time ;
`sharp` jamais invoqué — pas d'usage `next/image`). Le correctif est donc de
l'hygiène, pas une remédiation d'exposition active.

---

### Historique — état au 2026-08-15 (DASH-4C, avant correction)

`npm audit` : **6 vulnérabilités HIGH**, toutes **pré-existantes** et **build-time**
(non exposées au runtime client) :

| Paquet | Avis | Origine (chaîne) | Impact réel |
|--------|------|------------------|-------------|
| `brace-expansion` | GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895 (DoS) | `@tailwindcss/postcss` → `postcss` → `brace-expansion` + toolchain | Build-time uniquement (glob) ; pas de surface runtime |
| `postcss` | GHSA-qx2v-qp2m-jg93 (XSS via `</style>`), GHSA-6g55-p6wh-862q (lecture fichier via sourceMappingURL) | `@tailwindcss/postcss` → `postcss@8.4.31` | Build-time (compilation CSS de sources maîtrisées) |

### Attribution — DASH-4C (@dnd-kit)

La dépendance ajoutée en DASH-4C est **@dnd-kit** (`@dnd-kit/core`, `@dnd-kit/sortable`,
`@dnd-kit/utilities`). `npm ls` confirme qu'elle **n'ajoute aucune dépendance tierce**
(uniquement ses propres paquets scoppés) et **n'introduit aucune** des vulnérabilités
ci-dessus. Aucune HIGH nouvelle n'est introduite par cette PR.

### Pourquoi pas de fix maintenant

`npm audit fix` (brace-expansion) est appliquable mais touche une sous-dépendance de
build ; `npm audit fix --force` remonte `postcss`/potentiellement la toolchain
Tailwind/Next → **risque de régression de build** en pleine slice fonctionnelle.
Décision : **ne pas patcher dans une PR fonctionnelle**.

### Plan (passe dédiée)

1. Brancher `chore/deps-audit`, exécuter `npm audit fix` (non-force) et valider les 4 gates.
2. Évaluer le bump `postcss`/`@tailwindcss/postcss` isolément (build + rendu visuel).
3. Merger séparément une fois les gates verts, sans changement fonctionnel.
