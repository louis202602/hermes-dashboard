# Media Optimizer v3 — application en production OVH `hermes_os` (2026-10-09)

Aucun secret dans ce document. Preuves brutes : `/var/backups/hermes-visibility/hv-media-v3-20261009T051424Z/prod_apply/` (SHA256SUMS) sur hermes-vps-new.

## Déroulé
1. Pré-contrôles : empreintes SHA-256 identiques (fichiers testés = fichiers appliqués, voir `..._VERIFICATION.md`) ; schéma de production inchangé depuis les tests (`pg_dump -s` identique hors jetons aléatoires) ; sauvegarde complète `hermes_os_full.dump` (98c586ab…) + sauvegarde fraîche `hermes_os_preapply.dump` (243c0003…) lisibles ; aucune transaction/DDL concurrente ; verrou `production_migration_lock` libre (ancien verrou expiré depuis le 01/09, repris proprement), acquis puis relâché ; test : second propriétaire refusé (`STOP_CONCURRENT_MIGRATION`, `NOT_OWNER`).
2. Migration v3 : `psql -1 -v ON_ERROR_STOP=1`, 0 erreur. Différentiel de catalogue : 151 ajouts, 2 modifications attendues (corps de `public.social_publish` = garde STOP ; USAGE du schéma `hermes_os` pour `hv_media_worker`).
3. Copie des 5 jobs (+4 lignes de bibliothèque) : OK, 2ᵉ passage idempotent, contrôle d'empreinte intégré. 5 jobs `heliosolar`, tous `optimized` / `pending_review`.
4. Droits : matrice 40 rôles × 2 680 cas = 0 écart ; RLS activée sur les 5 tables ; `hv_media_worker` sans appartenance ; `anon` sans accès aux 5 façades.
5. `social_publish` : `EXECUTE` retiré à `anon`, `authenticated`, `hermes_web_anon` (script testé 5cffeafb…). PUBLIC n'avait pas ce droit. Aucun appelant légitime (93 workflows n8n, dashboard, cron, vues, fonctions : seule mention = un commentaire dans `social_dispatch_consumer`). Appels réels : refus pour les 3 rôles ; `hermes_app` avec un plan SCHEDULED → `PUBLISH_STOPPED` (transaction annulée).
   Reste ouvert : `authenticator` et `staging_authenticator` (rôles de connexion PostgREST, NOINHERIT) gardent un EXECUTE direct (palier 2, non appliqué).
6. Rôle technique : mot de passe aléatoire (vérificateur SCRAM posé côté base, mot de passe dans un fichier 0600 sur le VPS pipeline, hors dépôt). Pipeline : `hv_media_pipeline.py` remplacé par la variante OVH (anciens fichiers `*.supabase.bak`), `pipeline.json` pointe 10.10.0.1:5432/hermes_os via WireGuard. 55 aperçus poussés.
7. n8n : credential Postgres OVH dédié ; workflow `HV Media Optimizer -> brouillon Buffer` (id 6L4ab7VEn9rYwHc4) créé **INACTIF**.
8. Test de bout en bout synthétique (image de mire, job `is_test`) : exposition par jeton (HTTP 200 avec jeton, 404 sans) → légende Ollama → brouillon Buffer Instagram créé et relu (`draft`) → enregistré dans Visibility OS (plan CANCELLED après coup) → brouillon supprimé via l'API Buffer (relecture : « Post not found ») → job neutralisé (blocked/rejected), jeton retiré, fichier supprimé. Aucune publication : `social_publications` = 1 ligne `FAILED`, `is_dry_run = true` (trace du brouillon supprimé).
9. STOP `heliosolar` = actif tout du long.

## Non-régression
Services OVH actifs sans redémarrage (PostgREST, GoTrue, nginx, ap2-runner) ; n8n : 96 exécutions réussies / 0 erreur depuis la migration ; aucun journal PostgREST en erreur.
Constat hors périmètre, antérieur à la migration (depuis le 06/10) : `ap2-autonomy.service` en échec chaque minute — `null value in column "title" of relation "action_item"` (insertion `BID_DEADLINE` d'Autonomous Prospect V2). Non modifié.

## hermes.vault_key — état
- Nature : réglage de base (`ALTER DATABASE hermes_os SET "hermes.vault_key"`), clé de chiffrement symétrique (pgcrypto) du schéma `vault` maison (`vault.create_secret`, vue `vault.decrypted_secrets`). La staging a une autre clé.
- Protège 1 secret : `n8n_api_key_chatgpt_hermes` (production). Aucune ligne de table métier ne référence le vault. Consommateurs de `decrypted_secrets` : `hermes_os._hb_n8n_http`, fonctions Qonto (`qonto_refresh_access_token`, `configure_qonto_oauth_credentials_self`, `complete_*_connection_self`).
- Active : oui (déchiffrement OK).
- Expositions constatées : (a) lisible par tout rôle SQL (`current_setting`, y compris `anon`) — mais `vault.secrets` n'a aucun droit pour eux, donc la clé seule ne déchiffre rien ; (b) en clair dans les deux sauvegardes `pg_dump -Fc` (entrée « DATABASE PROPERTIES »), répertoire postgres 0700 ; (c) affichée une fois dans le journal de cette session de travail (retirée des fichiers d'audit ; aucun résidu sur les VPS, hors sauvegardes) ; (d) jamais dans le dépôt ni les logs PostgreSQL.
- Restauration : `pg_restore -C` ré-applique la clé avec les secrets chiffrés (cohérent) ; un restore sans `-C` perd la clé → déchiffrement impossible.
- Rotation : NON effectuée. Plan : (1) sauvegarde ; (2) tester sur base jetable restaurée ; (3) nouvelle clé générée hors journaux ; (4) en une transaction, ré-chiffrer `vault.secrets` (decrypt ancienne clé → encrypt nouvelle) puis `ALTER DATABASE … SET` ; (5) les sessions déjà ouvertes gardent l'ancienne valeur : planifier la bascule (reconnexion des pools PostgREST/n8n) hors plage d'usage de `_hb_n8n_http` ; (6) nouvelle sauvegarde (contient la nouvelle clé) ; (7) retirer l'exposition par `current_setting` en déplaçant la clé dans une table réservée à `postgres` lue par les seules fonctions SECURITY DEFINER ; (8) régénérer ensuite le secret protégé (clé API n8n ChatGPT-Hermes) puisqu'il a été exposé à la même clé.
