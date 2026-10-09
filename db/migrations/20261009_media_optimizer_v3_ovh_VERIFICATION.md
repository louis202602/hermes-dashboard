# Media Optimizer v3 (OVH) — rapport de vérification avant application

Rien de ce document n'a été appliqué en production. Tous les tests ont tourné sur une **copie jetable** (cluster PostgreSQL 17.11, même version que la production, port local 55433) restaurée depuis une sauvegarde complète de `hermes_os`.

## 1. Base officielle
- Production = **PostgreSQL OVH `hermes_os`** (hermes-vps-new, PG 17.11, PostgREST + GoTrue de production). Écritures du jour constatées.
- Supabase `smubxqorirlfldatzmym` = filet de retour arrière **gelé** (dernières écritures 25–26/09, hors objets Media Optimizer v1 créés par ce module). Les migrations v1/v2 (orientées Supabase) sont marquées *remplacées* et ne doivent plus être appliquées.

## 2. Empreintes SHA-256 (fichiers testés = fichiers à appliquer)
| Fichier | SHA-256 |
|---|---|
| `20261009_media_optimizer_v3_ovh.sql` | `2e335ae376289c20bbd7438c171f6ccf087986cc9df1bd16a9b09aae0675ea3c` |
| `20261009_media_optimizer_v3_ovh_data_copy.sql` | `1c1cb814ea987d4a059a0d1f11f9aa8e483244d12720d84b520f064a2d05f404` |
| `20261009_media_optimizer_v3_ovh_rollback.sql` | `88dc6ded3a0ce52fa549bc46f1a04dbab713c9ec7b15dd91e5def18b8858d80d` |
| `20261009_media_optimizer_v3_ovh_social_publish_acl_PROPOSITION.sql` (non appliqué sans décision) | `5cffeafb00a6df819e85572805cbe3800f1447bd00bc11d7448f0696437a7ec1` |

Les mêmes empreintes ont été relevées sur le serveur de test, dans le dépôt et dans `tests_v3/SHA256SUMS` (répertoire de sauvegarde). Avant application : recalculer et comparer.

## 3. Résultats
- Sauvegarde `pg_dump -Fc` 160 Mo (SHA `98c586ab…`), restauration sans erreur (511/511 tables, tables concernées identiques à la production).
- Application ×2 : 0 erreur, **différentiel entre 1ʳᵉ et 2ᵉ application = 0** (idempotent).
- Différentiel de catalogue avant/après : **uniquement des ajouts**, hormis (a) le corps de `public.social_publish` (garde STOP), (b) l'USAGE du schéma `hermes_os` pour `hv_media_worker`. Aucun droit existant modifié.
- Matrice de droits : 40 rôles × 2 680 combinaisons → **0 écart**. Seul `hv_media_worker` a des droits (colonnes bornées, lignes bornées à ses tenants par RLS) ; `authenticated` n'a que les 5 façades ; `anon`, `service_role`, `hermes_os_legacy_n8n` (ACL par défaut), `hermes_web_anon` et tous les autres : rien.
- Tests fonctionnels : **59 + 29 = 88 réussis, 0 échec** (isolation tenant, droits réservés à l'humain, cohérence canal/réseau, doublons, verrou des brouillons, garde STOP, aperçus cloisonnés, utilisateurs JWT, anon).
- Pipeline : toutes les requêtes SQL réelles rejouées sous `hv_media_worker` → OK ; modifications interdites → refusées.
- Copie de données (5 jobs + 5 lignes de bibliothèque) : OK, idempotente, contrôle d'empreinte intégré.
- Rollback depuis l'état peuplé : état d'origine restitué (corps de `social_publish` identique, md5 `9b80ecf5…`) ; données conservées dans 8 tables de sauvegarde inaccessibles aux rôles applicatifs ; seul résidu : le rôle `hv_media_worker` désactivé. Ré-application ensuite OK.

## 4. Défauts trouvés *par* les tests et corrigés avant cette empreinte
1. Précondition : cast `::regclass` évalué même si la table n'existe pas.
2. Rollback : suppression de `media_worker_allows` avant les politiques RLS qui en dépendent.
3. Ré-application après rollback : le rôle restait `nologin`.
4. Copie de données : colonnes NOT NULL de la v3 mises à NULL par `jsonb_populate_recordset`.

## 5. Risques résiduels (non bloquants, à connaître)
- `public.social_publish` / `social_generate_content` / `social_plan_content` restent exécutables par 38 rôles tant que la proposition de droits n'est pas appliquée (la garde STOP bloque déjà toute publication).
- `set_media_rights` (décision humaine) passe `social_media_library.is_usable` à vrai : le planificateur historique pourrait alors consommer ce média. Comportement voulu et réservé aux humains.
- La bibliothèque contient déjà « Socomac » (`is_usable = true` depuis septembre) : non modifiée.
- Test réalisé sur copie : le comportement sous charge de la production et le trafic PostgREST réel ne sont pas rejoués.
