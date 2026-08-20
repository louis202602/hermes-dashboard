# Pack Photovoltaïque Hermès — LOT PV-5

**Le devis : l'artefact commercial qui transforme un dossier prêt en proposition.**

> `PV_ACTIONS_ENABLED = NO` · `AGENT_4_ACTIVATED = NO` · `AGENT_5_ACTIVATED = NO` ·
> `N8N_TOUCHED = NO` · **0 signature électronique, 0 acompte, 0 paiement, 0 facture client.**

PV-4 produisait un état terminal, `READY_FOR_OFFER`, que **rien ne consommait** :
le moteur s'arrêtait sur une promesse sans destinataire. Et la machine à états du
prospect n'avait **aucun état** entre `STUDY_DELIVERED` et `WON` — mesuré, pas
supposé : un prospect passait donc de « étude livrée » à « gagné » sans qu'aucun
artefact ne justifie le passage. PV-5 pose cet artefact et ferme ce trou.

**Tout est manuel.** Aucune capacité IA n'est créée, aucun agent n'intervient,
aucun workflow n'est appelé, aucun cron n'est planifié.

---

## 1. Les totaux ne viennent jamais du navigateur

C'est la propriété structurante du lot, et elle tient en deux mécanismes :

```sql
line_total_ht_eur numeric(14,2) not null
  generated always as (round(quantity * unit_price_ht_eur * (1 - discount_pct/100), 2)) stored
```

Le total d'une ligne est une **colonne générée**. Il n'existe aucun chemin —
façade, SQL direct, déclencheur — par lequel écrire un total faux : PostgreSQL le
calcule ou refuse l'écriture. Les totaux du devis, eux, sont recalculés par
déclencheur à chaque mouvement de ligne et à chaque changement de remise globale.

**Aucune façade n'accepte de total**, et aucun formulaire ne porte de champ qui
en soit un. Ce n'est pas une validation qu'on pourrait contourner : c'est
l'absence de point d'entrée. Assertion testée sur les onze signatures et sur les
noms de champs de l'écran.

### La règle d'arrondi, et pourquoi elle est écrite

```
base_taux = Σ(total_ligne du taux) × (1 − remise_globale)
tva_taux  = round(base_taux × taux, 2)        ← arrondi UNE fois PAR TAUX
```

La remise globale est répartie **proportionnellement** sur chaque ligne avant la
TVA : sinon, avec deux taux, elle avantagerait arbitrairement l'un des deux.

> **Ce que le mutation testing a trouvé.** L'assertion initiale sur ce point
> passait aussi bien avec un arrondi par ligne qu'avec un arrondi par taux : sur
> le jeu d'essai choisi, les deux donnent 813,41 €. Elle ne prouvait donc pas la
> règle qu'elle documentait. Le cas qui les sépare a été ajouté — trois lignes à
> 0,03 € à 20 % : par taux 0,02 €, par ligne 0,03 €.

## 2. La source de vérité d'un devis

Un devis ne peut naître que d'un dossier réellement prêt :

- étude **`VALIDATED`** — la même règle déterministe qu'en PV-4 : version la plus haute ;
- chiffrage **`VERIFIED`** de cette étude — le plus récent ;
- prospect non opposé.

Sinon : `QUOTE_NOT_READY`, **avec la liste des raisons** (`missing_requirements`),
jamais un booléen. Un écran doit pouvoir dire *ce qui* manque.

Onze codes de blocage sont définis, de `STUDY_NOT_VALIDATED` à
`VALIDITY_DATE_MISSING`. Ils sont revérifiés à chaque passage d'état : un devis
préparé hier peut s'appuyer sur une étude dont le statut a changé depuis.

## 3. Numérotation

`DEV-<année>-<6 chiffres>`, atomique par (tenant, année) :

```sql
insert into pv_quote_sequences (tenant_id, year, last_number) values (…, 1)
on conflict (tenant_id, year) do update set last_number = last_number + 1
returning last_number
```

L'`on conflict do update … returning` prend un **verrou de ligne** : deux
transactions concurrentes s'attendent, et la seconde lit la valeur déjà
incrémentée. Aucune lecture-puis-écriture, donc aucune fenêtre de course. La
contrainte `unique (tenant_id, quote_number, version)` est la garantie de dernier
recours : même en contournant la fonction, la base refuse le doublon.

> **Limite honnête** : la concurrence entre sessions n'est pas exerçable depuis
> une transaction de test unique. Ce qui est prouvé, c'est l'absence de doublon
> sur 50 tirages, la continuité de la séquence, et le refus du doublon par la
> contrainte.

## 4. Numéro vs version

| | Rôle |
|---|---|
| `quote_number` | Référence **commerciale** — celle que le client cite. Ne bouge pas. |
| `version` | Révision successive de cette même offre. |

Un devis émis reste citable après révision, ce qu'un simple numéro incrémenté
rendrait impossible.

## 5. Machine à états, en données

Quinze chemins déclarés dans `pv_quote_transitions` — même forme qu'en PV-1
(prospect) et PV-3 (étude/chiffrage). Ajouter un chemin = insérer une ligne.

```
DRAFT ──► READY ──► SENT ──► ACCEPTED
   │        │         ├────► REFUSED
   │        │         └────► EXPIRED
   └────────┴─────────┴────► CANCELLED / SUPERSEDED
```

Ce que la table **interdit**, et pourquoi :

| Chemin | Raison |
|---|---|
| `DRAFT → ACCEPTED` | un devis jamais transmis ne peut pas être accepté |
| `DRAFT → SENT` | on passe par `READY`, le point de contrôle de complétude |
| `ACCEPTED → *` | un engagement accepté ne se rétracte pas par un changement de statut |

## 6. Immutabilité après envoi

Une fois `SENT`, le **contenu commercial** est gelé — devis **et** lignes. Geler
le devis sans geler ses lignes serait une porte fermée à côté d'une fenêtre
ouverte. Reste modifiable : le statut et les traces d'issue. Rien de ce qui
engage un prix.

**La révision est la seule voie** : `revise_pv_quote` crée une nouvelle version
en `DRAFT`, conserve le numéro commercial, recopie les lignes, et passe
l'ancienne en `SUPERSEDED` **sans la toucher autrement**. Ce que le client a reçu
reste exactement ce qu'il a reçu.

Un devis `ACCEPTED` ne se révise pas : `QUOTE_ACCEPTED_IMMUTABLE`.

## 7. Le prospect : le trou commercial est fermé

**Avant PV-5**, mesuré : `STUDY_DELIVERED → WON` était un chemin **direct**.

**Après** : trois états commerciaux explicites, et `WON` n'est plus atteignable
**que** depuis `OFFER_ACCEPTED`.

```
STUDY_DELIVERED ──► OFFER_PREPARED ──► OFFER_SENT ──► OFFER_ACCEPTED ──► WON
```

⚠️ **Changement de comportement assumé** : le chemin direct est **retiré**. Les
prospects déjà en `WON` ne bougent pas — seule la route future change.

**L'acceptation d'un devis ne fait pas passer le prospect à `WON`**, seulement à
`OFFER_ACCEPTED`. Gagner l'affaire reste un second geste délibéré : une offre
acceptée n'est pas encore un chantier.

## 8. Acceptation — un humain, jamais un agent

PV-5 ne fait **aucune signature électronique**. Un humain autorisé *enregistre*
une acceptation constatée : date, et référence documentaire si elle existe.

La garde est celle de PV-1, **réutilisée telle quelle** et paramétrée :
`pv_human_validation_guard('status','ACCEPTED','accepted_by','accepted_at')`. Elle
refuse quand `auth.uid()` est NULL (un runner, un `service_role`), quand l'acteur
ou l'horodatage manque, ou quand l'acteur déclaré n'est pas l'appelant.
`SECURITY DEFINER` ne la contourne pas : `auth.uid()` lit le jeton de la requête.

L'écran exige en plus une confirmation explicite, et dit que Hermès ne recueille
aucune signature.

## 9. « Marquer comme envoyé » n'est pas un envoi

**PV-5 n'expédie aucun courriel.** Le bouton enregistre un geste humain, et
l'écran comme le message de retour le disent en toutes lettres. Laisser croire
qu'un message est parti serait un mensonge sur ce que le système sait.

## 10. Expiration, sans planificateur

n8n est hors périmètre, et le rester est une contrainte, pas un oubli. La
péremption est donc traitée deux fois :

- **calculée à la lecture** (`is_expired`) — un devis échu se voit même si
  personne n'a rien lancé ;
- **applicable à la demande** (`expire_pv_quotes()`), avec confirmation explicite
  dans l'écran : faire basculer des offres transmises en « périmé » change leur
  état commercial.

**Aucun cron, aucun scheduler, aucun workflow** — assertion testée.

## 11. Le PDF de devis

Distinct de la synthèse d'étude, et il doit le rester **visiblement** : l'un est
une projection indicative, l'autre engage un prix. Trois choses les séparent à
l'œil : le titre, le tableau de lignes chiffrées, et l'absence de la mention
« non contractuel » — remplacée ici par des conditions et une durée de validité.

Le moteur PDF a été **extrait** en `lib/pv/pdfEngine.ts`, partagé avec la synthèse
de PV-4. Extraire plutôt que dupliquer : deux écrivains PDF divergeraient — l'un
corrigerait un échappement que l'autre garderait faux. **Aucune dépendance
ajoutée.**

| Stade | Condition | Marquage |
|---|---|---|
| `QUOTE_DRAFT` | aucune | bandeau **BROUILLON — NON ÉMIS — NE PAS TRANSMETTRE AU CLIENT** + cachet sur **chaque** page |
| `QUOTE_FINAL` | zéro blocage **et** devis au moins `READY` | — |

Le stade est décidé côté serveur et **revérifié en base**
(`QUOTE_PDF_NOT_READY` + raisons). Deux gardes indépendantes sur ce qui engage un prix.

**Aucune valeur n'est inventée** : une donnée absente s'affiche « Non renseigné ».
Un devis sans ligne le **dit**, plutôt que d'afficher un tableau vide sans
explication. Une remise de ligne est **écrite** : un total plus bas que
quantité × prix sans explication ferait douter le client, à juste titre.

Traçabilité : tenant, site, étude, chiffrage, **devis**, stade, auteur, SHA-256,
MIME, taille, chemin privé. Idempotence par `generation_request_id`. Bucket privé
inchangé, aucune URL persistée, URL signée 300 s, chemin demandé à la base et
revalidé (`PATH_OUT_OF_SCOPE`).

## 12. Audit

`entity_audit_log` via `_pv_audit`, comme tout le Pack PV. **Aucun journal
parallèle** : un second registre finirait par diverger du premier, et personne ne
saurait lequel fait foi. Tracés : création, révision, mouvements de lignes,
chaque changement de statut, l'acceptation nommément.

## 13. TVA — pas de promesse de conformité

Le taux est **porté par la ligne**, stocké tel quel. Hermès ne promet **aucune
conformité fiscale automatique** : la réglementation dépend du contexte
(puissance, logement, rénovation) et change. L'application propose 20 % par
défaut — c'est une **aide de saisie**, pas une règle métier. Le PDF affiche la
ventilation par taux et rappelle que les taux relèvent de la réglementation en
vigueur à la date d'émission.

## 14. Hors périmètre, volontairement

Ni signature électronique, ni acompte, ni paiement, ni facture client, ni
fournisseurs, ni commandes matériel, ni stock, ni visite technique complète, ni
Consuel, ni Enedis. Assertion testée sur les quatre migrations.

## 15. Rollback

`db/migrations/20260822_pv5_9_rollback.sql`.

⚠️ **DESTRUCTIF sur les données commerciales** : `pv_quotes` et `pv_quote_lines`
sont supprimées. Tout devis créé disparaît, versions comprises. Les PDF déjà
déposés **restent** dans le bucket (aucune suppression d'objet Storage en SQL —
c'est interdit), mais perdent leur rattachement.

⚠️ **Il rouvre le trou commercial** : le chemin `STUDY_DELIVERED → WON` est remis.

⚠️ **Il échoue volontairement** si des prospects sont en état `OFFER_*` : les
requalifier explicitement d'abord. Écraser silencieusement l'état commercial de
vrais prospects serait pire que l'échec.

## 16. Ce qui reste `BLOCKED_EXTERNAL`

**Leaked Password Protection** est toujours désactivée. Elle ne s'active que
depuis le tableau de bord Supabase — aucune migration ne peut le faire, et rien
n'a été simulé ni contourné.

> **Supabase → Authentication → activer Leaked Password Protection avant le
> premier pilote réel.**
