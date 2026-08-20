# Pack Photovoltaïque Hermès — LOT PV-4

**Le pack devient un dossier commercial : purge d'administrateur, widgets réellement
affichés, vue Affaire, moteur d'état, synthèse PDF non contractuelle.**

> `PV_ACTIONS_ENABLED = NO` · `AGENT_4_ACTIVATED = NO` · `AGENT_5_ACTIVATED = NO` ·
> `N8N_TOUCHED = NO` · **0 devis, 0 signature, 0 paiement.**

PV-3 a rendu le pack exploitable à la main. Il restait quatre écarts entre
« ça fonctionne » et « on peut vendre avec » : le seul geste irréversible était
ouvert à tout membre, les widgets déclarés n'étaient affichés nulle part, un
commercial devait parcourir quatre écrans pour lire un dossier, et rien ne
sortait du système pour être montré à un client. PV-4 ferme ces quatre écarts.

---

## 1. La purge devient un geste d'administrateur

**Aucun nouveau système de rôles.** Hermès porte déjà ses droits dans
`hermes_os.user_tenant_permissions` : des chaînes de permission accordées par
(utilisateur, tenant). `tenant.admin` existe et est déjà attribuée. On l'utilise
telle quelle.

`hermes_os.pv_guard_admin()` est une extension **stricte** de `pv_guard()` :
mêmes codes de refus, plus un seul — `NOT_ADMIN`. Distinguer ce refus est
délibéré : l'écran peut dire « demandez à un administrateur » plutôt qu'« accès
refusé », qui n'apprend rien.

Les **deux** façades sont gardées, pas seulement la purge :

| Façade | Avant PV-4 | Après PV-4 |
|---|---|---|
| `list_pv_documents_to_purge` | tout membre | `tenant.admin` |
| `mark_pv_document_purged` | tout membre, **sans** contrôle de délai | `tenant.admin`, **délai revérifié** |

Énumérer ce qui est purgeable fait partie du geste de purge : donner la carte à
qui ne peut rien en faire n'a aucune utilité métier.

L'ancienne surcharge `mark_pv_document_purged(uuid)` est **supprimée**. La
laisser vivante offrirait un chemin sans contrôle de délai de grâce, et
PostgreSQL choisirait la surcharge la plus spécifique sans prévenir personne.

**Le délai de grâce de 7 jours est revérifié dans la façade d'écriture**, pas
seulement dans la liste : une garde qui ne tient que sur le chemin nominal ne
tient pas. Le comparateur `<=` du correctif PV-3/3b est conservé — `<` est faux
à l'égalité, `now()` étant constant dans une transaction.

### Vocabulaire : deux gestes, deux mots

| Libellé | Effet | Réversible |
|---|---|---|
| **Retirer** | suppression **logique** — la ligne survit, traçable | oui, 7 jours |
| **Purger définitivement** | efface les **octets** via l'API Storage | **non** |

**Aucun bouton « Supprimer ».** Le mot ne dit pas lequel des deux gestes il
déclenche, et l'un des deux est irréversible. C'est une assertion testée sur le
contenu de chaque `<button>` de l'écran.

La confirmation est **obligatoire** : une case à cocher `required`, plus la
phrase exigée, affichée avant le bouton :

> Cette action supprimera définitivement le fichier après le délai de grâce.
> **Cette opération est irréversible.**

**Le serveur reste l'autorité.** La confirmation protège contre l'erreur
humaine, pas contre la malveillance : l'action refuse sans `confirm=PURGER`
(`CONFIRMATION_REQUIRED`), et surtout la base refuse sans `tenant.admin`,
indépendamment de l'écran. Contourner l'interface ne permet à personne de purger.

## 2. Journal de purge — une jointure, pas une seconde source

**Aucune nouvelle table d'audit.** Tout était déjà là : `pv_documents` porte
`deleted_at`, `deleted_by`, `purged_at`, `purged_path` ; `entity_audit_log`
porte `changed_by` et l'horodatage. `get_pv_purge_journal(integer)` est donc une
jointure — pas un second système à maintenir et à désynchroniser.

Neuf informations par ligne : document, type, site, nom d'origine, date de
retrait logique, date de purge physique, **qui** a purgé, ancien chemin, issue.

**Lecture ouverte à tout membre**, délibérément. Savoir qu'un document a été
détruit, par qui et quand, n'est pas un privilège d'administrateur — c'est ce
qui rend l'irréversible acceptable.

## 3. Les widgets sont enfin affichés

`EditableWidgetGrid` existait depuis DASH-4C mais **n'était rendue nulle part** :
le catalogue de widgets était une déclaration sans effet, pour le photo comme
pour le PV. `DashboardWidgetBoard` la branche sous le cockpit.

**Aucune grille spécifique PV.** Les widgets solaires arrivent par le chemin
commun : le module `solar.studies` les possède, la composition les autorise, le
catalogue les décrit. Un tenant photo n'en voit aucun — non pas parce qu'un `if`
les cache, mais parce qu'ils ne sont **jamais** dans `available`.

| Tenant | Widgets PV composés |
|---|---|
| solaire (`quotes` + `worksites`) | **3** |
| photo | **0** |
| immobilier | **0** |

Le coût suit l'usage : l'instantané PV n'est lu que si le tenant possède
réellement un widget solaire. Un tenant photo ne déclenche aucune lecture PV.

Persistance **optimiste et honnête** : l'affichage suit le geste, l'écriture part
derrière, et **revient en arrière** si elle échoue. Un écran qui affiche un ordre
non enregistré est pire qu'un écran qui n'a pas bougé.

## 4. La vue « Affaire PV » — agrégation, pas nouvelle vérité

`get_pv_deal(uuid)` n'écrit rien, ne calcule aucun chiffre métier et n'invente
aucune valeur. Elle agrège en une lecture ce que PV-1 à PV-3 ont posé : client,
site, consommation, facture vérifiée, étude retenue, chiffrage retenu,
hypothèses, documents, et l'historique des versions d'étude.

### Sélection déterministe — le point le plus facile à rater

```
étude retenue    = la VALIDATED de plus haut `version`      (aucune autre)
chiffrage retenu = le VERIFIED le plus récent DE CETTE étude (aucun autre)
```

Un `DRAFT` récent n'est **jamais** retenu. Une étude `CALCULATED`, même seule et
même fraîche, n'est pas retenue : elle n'a pas été validée par un humain.
Conséquence assumée : un dossier peut n'avoir **aucune** étude retenue tout en
ayant plusieurs études. C'est exact, et c'est ce que l'écran montre — la dernière
étude reste visible, séparément, sous son vrai statut.

**Pourquoi pas de colonne `is_retained`** : elle ajouterait un état à maintenir,
donc à désynchroniser (une étude marquée retenue puis rejetée). La règle
ci-dessus se déduit des données existantes et ne peut pas mentir. Si un jour un
opérateur doit retenir une version antérieure **contre** la règle, la colonne
deviendra justifiée — pas avant.

## 5. Le moteur d'état — des raisons, pas un code opaque

`resolvePvReadiness` est un module **pur**. Il renvoie un état **et la liste des
raisons** :

```ts
{ state: "BLOCKED", missingRequirements: ["ENERGY_NOT_VERIFIED", "STUDY_NOT_VALIDATED"] }
```

| État | Signification |
|---|---|
| `BLOCKED` | opposition client, ou donnée contradictoire : rien ne doit avancer |
| `INCOMPLETE` | il manque une donnée d'entrée (site, consommation, étude) |
| `READY_FOR_STUDY` | les entrées sont là, l'étude peut être faite |
| `STUDY_REVIEW_REQUIRED` | une étude existe mais attend une validation humaine |
| `READY_FOR_OFFER` | étude `VALIDATED` **et** chiffrage `VERIFIED` |

`READY_FOR_OFFER` exige les deux. Un `CALCULATED` ou un `NEEDS_REVIEW` ne
suffisent **jamais** — c'est la propriété testée sous plusieurs angles.

## 6. La synthèse PDF — professionnelle et NON CONTRACTUELLE

Titre : **« Synthèse d'étude photovoltaïque »**. Mention visible sur chaque
document :

> Étude indicative et non contractuelle, sous réserve de validation finale,
> visite technique, contraintes du site et conditions contractuelles.

**Aucune valeur n'est inventée.** Une donnée absente s'affiche « Non renseigné »
ou « — ». Un PDF qui comble ses trous avec des moyennes plausibles est un PDF qui
ment à un client.

| Stade | Condition | Bandeau |
|---|---|---|
| `STUDY_SUMMARY_DRAFT` | aucune | **BROUILLON — NON VALIDÉ — NE PAS TRANSMETTRE AU CLIENT** |
| `STUDY_SUMMARY_FINAL` | étude `VALIDATED` **et** chiffrage `VERIFIED` | — |

**Le stade est décidé côté serveur**, jamais reçu du client, et **revérifié en
base** : `PDF_FINAL_NOT_READY` avec sa raison (`STUDY_NOT_VALIDATED` ou
`ECONOMICS_NOT_VERIFIED`). Deux gardes indépendantes sur la seule chose qu'on ne
veut pas se tromper.

### Traçabilité

`register_pv_study_summary` rattache le fichier à son tenant, son site, son
**étude**, son **chiffrage**, son stade, son auteur, son horodatage, son
**SHA-256**, son MIME, sa taille et son chemin privé. `pv_documents` accueille
quatre colonnes additives — `study_id`, `economics_id`, `generation_request_id`,
`document_stage` — et **deux FK composites** `(tenant_id, …)`. Une FK sur
`study_id` seul aurait laissé un PDF pointer l'étude d'un autre tenant : la même
faille que PV-1 avait fermée sur les sites.

**Idempotence** : `generation_request_id` est unique par tenant (index
**partiel** — les documents déposés n'ont pas de clé et ne se gênent pas entre
eux). Rejouée, la même demande renvoie le document déjà produit —
`ALREADY_GENERATED`, aucun second fichier, aucun second objet dans le bucket.

### Stockage

Bucket **privé**, inchangé. Aucun objet public, **aucune URL persistée**, URL
signée **300 s** produite à la demande. Le chemin est demandé à la base
(`prepare_pv_document`), jamais reconstruit côté application : le tenant
n'apparaît nulle part dans le code applicatif, et la base revalide le préfixe
`<tenant>/<site>/` (`PATH_OUT_OF_SCOPE`).

### Sans nouvelle dépendance

Le PDF est écrit à la main, sur le modèle de `lib/attachments/imagesToPdf.ts`
déjà présent : Helvetica base-14, `/WinAnsiEncoding`, xref et trailer manuels.
Ajouter un moteur PDF complet pour six pages de texte aurait été un coût
permanent pour un besoin ponctuel. Les tests portent sur le **contenu décodé**,
pas sur l'existence d'un fichier : un PDF vide passerait un test d'existence.

## 7. Hors périmètre, volontairement

`pv_quotes`, lignes de devis, signature, acompte, facture client, paiement :
**rien de tout cela n'est créé**. C'est une assertion testée sur les trois
migrations. Un devis engage juridiquement ; il mérite son propre lot.

## 8. Rollback

`db/migrations/20260821_pv4_9_rollback.sql` retire exactement ce que les trois
migrations ont ajouté et **restaure les façades PV-3 avant** de supprimer
`pv_guard_admin()` — l'ordre inverse laisserait un instant où des fonctions
appellent une fonction absente.

⚠️ **Ce rollback DIMINUE une protection** : la purge redevient accessible à tout
membre et le contrôle de délai côté façade disparaît. Il fait aussi perdre le
rattachement des synthèses déjà générées. Ce n'est pas une raison de ne pas
l'écrire — c'en est une de le dire.

`pv_economics_tenant_id_key` est **conservée** : additive, sans effet de bord, et
la retirer casserait toute FK qui lui survivrait.

## 9. Ce qui reste `BLOCKED_EXTERNAL`

**Leaked Password Protection** est toujours désactivée. Elle ne s'active que
depuis le tableau de bord Supabase — aucune migration ne peut le faire, et rien
n'a été simulé ni contourné.

> **Supabase → Authentication → activer Leaked Password Protection avant le
> premier pilote réel.**
