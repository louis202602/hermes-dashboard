# Hermès — Connexions self-service & téléphonie gérée

État : **architecture + code préparatoire**. Aucune migration appliquée, aucun
secret configuré, aucun flux OAuth réel exécuté. `GO_LIVE = NO`.

---

## 1. Trois contraintes constatées décident de tout

Ce ne sont pas des préférences : ce sont des faits vérifiés avant d'écrire une
ligne.

| # | Constat | Conséquence |
| :-- | :-- | :-- |
| A | L'application Next.js ne détient **aucun secret** (`.env.example` : uniquement l'URL Supabase et la clé publiable ; invariant documenté dans `lib/voice/README.md`) | L'échange OAuth `code → token`, qui exige un `client_secret`, **ne peut pas** avoir lieu dans l'application |
| B | Ni `pg_net` ni `http` ne sont installés (extensions réelles : `btree_gist`, `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp`) | Postgres **ne peut pas** émettre de requête HTTP : l'échange ne peut pas s'y faire non plus |
| C | `supabase_vault` 0.3.1 **est installé**, et le schéma `vault` n'accorde aucun privilège à `authenticated` ni `anon` (vérifié : `false` pour les deux, `true` pour `service_role` et `postgres`) | Le mécanisme de secrets d'Hermès **existe déjà** — on n'en crée pas un second |

### La seule répartition qui respecte les trois

```
Navigateur   ─── ne voit qu'un STATUT ('CONNECTED', 'REVOKED', …)
                 jamais un jeton, jamais un vault_secret_id
     │
Application  ─── démarre le flux : URL d'autorisation + state anti-CSRF
                 ne détient aucun secret · ne reçoit aucun jeton
     │
Fournisseur  ─── l'utilisatrice s'authentifie CHEZ LUI (mot de passe jamais vu)
     │
n8n          ─── porte le client_secret · reçoit le callback · échange le code
                 puis appelle complete_integration_connection en service_role
     │
Vault        ─── détient les jetons
                 la table ne stocke qu'un POINTEUR vers vault.secrets
```

> ⚠️ **Blocage honnête** : ce bouclage dépend de **n8n**, aujourd'hui
> indisponible (blocage OVH). Le schéma et les façades sont prêts ; le flux ne
> peut pas se fermer tant que n8n ne l'est pas.

---

## 2. Google Calendar — six états, fail-closed

`NOT_CONNECTED` · `CONNECTING` · `CONNECTED` · `ERROR` · `REAUTH_REQUIRED` ·
`REVOKED`

**Seul `CONNECTED` autorise un usage**, et encore : un jeton expiré est refusé,
une date d'expiration illisible est refusée. Le doute n'autorise jamais.

Les transitions sont contraintes : `REVOKED → CONNECTED` est **interdit**, il
faut repasser par un vrai flux OAuth. Idem pour `REAUTH_REQUIRED`.

### Ce que l'agenda change — et ce qu'il ne change pas

| Capacité | Sans Calendar | Avec Calendar connecté **et** autorisé |
| :-- | :-- | :-- |
| Décrocher | ✅ | ✅ |
| Qualifier le prospect | ✅ | ✅ |
| Créer le lead | ✅ | ✅ |
| Proposer un rappel | ✅ | ✅ |
| Lire une disponibilité | ❌ | ✅ |
| Proposer un créneau | ❌ | ✅ |
| **Confirmer une réservation** | ❌ | ❌ — reste soumis aux approbations (SW15) |

La dernière ligne n'est pas un oubli : **l'agent n'engage jamais seul le
studio**, agenda ou pas.

Il faut **les deux** conditions : une connexion utilisable *et* l'autorisation
explicite de la photographe (`agenda_lookup_allowed`). L'une sans l'autre refuse.

---

## 3. Où vivent les jetons — et pourquoi ils ne peuvent pas fuir

`tenant_integration_connections` ne porte **aucune** colonne de jeton, seulement
`vault_secret_id uuid`. Trois barrières, pas une :

1. **La table** ne contient pas le secret (juste un UUID opaque).
2. **La façade** `get_tenant_integrations()` ne projette pas `vault_secret_id`.
3. **Le type** `TenantIntegration` ne le porte pas — ce qui n'existe pas dans le
   type ne peut pas être sérialisé vers le navigateur.

Une contrainte de table interdit par ailleurs un `CONNECTED` **sans** pointeur :
un statut « connecté » ne peut pas mentir à un consommateur qui croirait pouvoir
appeler le fournisseur.

Le `state` anti-CSRF est stocké **en empreinte SHA-256**, jamais en clair, et
consommé atomiquement (`consumed_at is null` dans le `WHERE`) : un rejeu du
callback échoue même sous concurrence.

---

## 4. Retell — `HERMES_MANAGED`, structurellement

La règle est encodée dans la **séparation en deux tables**, pas dans une
consigne :

| | `photo_phone_config` | `phone_provisioning` |
| :-- | :-- | :-- |
| Qui écrit | **la photographe** | **Hermès** |
| Contenu | numéro entrant, horaires, accueil, prestations, sujets autorisés, règles de rappel/transfert, voix, langue | agent Retell, numéro acheté, webhook, pointeur Vault |
| Façade `authenticated` | oui (config métier) | **aucune** |
| Secrets | **aucun** | pointeur Vault uniquement, jamais la clé |

`external_agent_ref` est un **identifiant** (`agent_abc123`), pas un secret : il
ne permet aucun appel sans la clé, qui reste dans Vault côté infrastructure.

La façade `get_phone_status()` ne renvoie ni l'agent, ni le pointeur Vault, ni le
fournisseur — seulement un statut, son propre numéro, et ses coûts.

Le standard n'est opérationnel que si **les deux faces** le sont :
`TENANT_PHONE_DISABLED` ou `NOT_PROVISIONED_BY_HERMES` sinon.

---

## 5. Coûts — aucune estimation enregistrée comme réelle

Ventilation par appel : `retell_cost_usd`, `telephony_cost_usd`, `llm_cost_usd`,
`cost_usd`. **Aucune n'a de valeur par défaut** : un coût non facturé reste
`NULL`, jamais `0`.

`compute_phone_costs()` n'agrège que les appels dont le fournisseur a réellement
rapporté le coût (`cost_reported = true`), et expose `calls_without_reported_cost`
pour que l'écart soit **visible** au lieu d'être absorbé dans un total trop bas.

La provenance est à trois niveaux : `REAL` (tout est facturé) · `PARTIAL` (il en
manque) · `UNAVAILABLE` (aucun appel, ou aucun coût). SW23 peut ensuite appliquer
budgets journalier/mensuel, plafond par appel, alertes et kill-switch — moteurs
**existants**, non réécrits.

---

## 6. Données client — minimisation

Conservé : `call_id`, numéro appelant, durée, intention, créneaux structurés,
résumé factuel, action suivante, coûts.

**Jamais conservé** : audio intégral, transcription brute permanente. Un test
vérifie qu'aucune colonne `recording_url`, `audio_url` ni `transcript_full`
n'existe.

---

## 7. Généricité sans surarchitecture

Le catalogue déclare quatre fournisseurs (`google_calendar`, `gmail`, `meta`,
`instagram`) — ajouter le suivant sera **une ligne**, pas une migration. Mais un
seul est **implémenté** : `IMPLEMENTED_PROVIDERS = ["google_calendar"]`. Déclaré
n'est pas prêt, et l'interface le dit.

Rien n'est joignable tant qu'un opérateur Hermès n'a pas renseigné le `client_id`
**et** activé la ligne : `PROVIDER_NOT_PROVISIONED` sinon.

---

## 8. Ce qui reste bloqué

| Bloqué | Par quoi | À résoudre par |
| :-- | :-- | :-- |
| Bouclage du flux OAuth | n8n indisponible (OVH) — il porte le `client_secret` et reçoit le callback | Hermès |
| `client_id` Google | non provisionné (colonne `NULL`, ligne désactivée) | Hermès |
| Appels réels | credential Retell absent | Hermès — **jamais** le tenant |
| Mesure de latence et coût/minute | aucun appel réel autorisé | Hermès, au premier appel facturé |
| Pilote | tenant Vanessa inexistant | dépend seulement du `tenant_id` et de l'e-mail |
