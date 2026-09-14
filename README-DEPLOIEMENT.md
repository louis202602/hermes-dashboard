# Migration OVH VPS — Hermès (guardée, non destructive)

Ce document décrit les scripts de `scripts/vps/` et le workflow GitHub Actions
`ovh-vps-admin.yml` utilisés pour préparer un VPS OVH destiné à héberger PostgreSQL +
PostgREST pour Hermès OS, **sans jamais basculer la production ni modifier Supabase**.

## Principes de garde-fou (valables pour tous les scripts)

- Tous les scripts sourcent `scripts/vps/lib/common.sh` (`set -euo pipefail`, logging
  horodaté, `require_root`, `require_var`, `confirm_or_fail`, garde-fou anti-destructif).
- Idempotents : peuvent être relancés sans effet de bord (vérification de l'existant
  avant toute création/modification).
- Aucun secret en dur : tout passe par des variables d'environnement (`require_var`)
  alimentées par des GitHub Secrets/Variables.
- Aucune commande destructive (`DROP`, `TRUNCATE`, `rm -rf /`, `mkfs`, `dd if=`).
- La migration ne vise qu'une base **staging** locale — `hermes_os` (source Supabase) et
  la production ne sont jamais modifiées.
- `healthcheck.sh`, `verify_target.sh` et la lecture Supabase de `prepare_migration.sh`
  sont strictement en lecture seule.

## Ordre d'exécution recommandé

1. `healthcheck.sh` — état des lieux en lecture seule, à tout moment.
2. `bootstrap.sh` — paquets de base, UFW (avec port 22 toujours explicitement autorisé
   avant toute activation), fail2ban, mises à jour auto. **Ne touche jamais à
   l'authentification SSH.**
3. `harden_ssh.sh` *(optionnel, guardé)* — désactive le login root et l'auth par mot de
   passe. Exige `CONFIRM=HARDEN_SSH` et vérifie qu'un accès par clé existe déjà pour un
   utilisateur sudo (ou root) avant toute modification, pour éviter un verrouillage.
   Valide la config avec `sshd -t` avant tout reload ; abandonne proprement sinon.
4. `install_postgres17.sh` — installe PostgreSQL 17 (dépôt PGDG), crée les rôles et la
   base `hermes_os`, écoute en local uniquement.
5. `install_extensions.sh` — installe `pg_cron` et active `pg_cron` +
   `pg_stat_statements` en **fusionnant** `shared_preload_libraries` (aucune bibliothèque
   existante n'est écrasée).
6. `install_postgrest.sh` — installe PostgREST, configuré pour écouter
   **exclusivement sur `127.0.0.1`**. Le script vérifie le binding après démarrage et
   arrête le service si une exposition publique est détectée.
7. `setup_backups.sh` — dump PostgreSQL quotidien + copie hors-VPS via rclone/S3.
8. `setup_monitoring.sh` — snapshot système + top requêtes `pg_stat_statements`.
9. `prepare_migration.sh` — inventaire en lecture seule de Supabase, dump du schéma
   `hermes_os`, restauration dans une base staging dédiée et horodatée
   (`hermes_os_staging_<timestamp>`). La source Supabase et `hermes_os` local ne sont
   jamais modifiées.
10. `verify_target.sh <staging_db>` — compare (lecture seule des deux côtés) la base
    staging au schéma source Supabase : nombre de tables, liste des tables, row counts
    approximatifs, extensions. Sort en erreur (code 2) si un écart est détecté.

## PostgreSQL / PostgREST — contraintes réseau

- PostgreSQL reste non exposé publiquement (`listen_addresses = 'localhost'`).
- PostgREST n'écoute que sur `127.0.0.1` (`server-host` forcé, vérifié après démarrage).
- `pg_cron` et `pg_stat_statements` coexistent dans `shared_preload_libraries` — la
  fusion est vérifiée avant tout redémarrage de PostgreSQL.

## Variables requises (GitHub Secrets / Variables)

| Nom | Type | Utilisé par |
|---|---|---|
| `VPS_SSH_PRIVATE_KEY` | Secret | workflow (connexion SSH) |
| `VPS_HOST` | Variable | workflow |
| `VPS_USER` | Variable | workflow |
| `VPS_HOST_PUBLIC_KEY` | Variable (recommandé) | workflow (pinning de la clé d'hôte) |
| `PG_SUPERUSER_PASSWORD` | Secret | `install_postgres17.sh` |
| `PG_HERMES_APP_PASSWORD` | Secret | `install_postgres17.sh` |
| `PGRST_AUTHENTICATOR_PASSWORD` | Secret | `install_postgrest.sh` |
| `BACKUP_S3_ENDPOINT` / `BACKUP_S3_BUCKET` / `BACKUP_S3_ACCESS_KEY` / `BACKUP_S3_SECRET_KEY` | Secrets | `setup_backups.sh` |
| `SUPABASE_DB_URL` | Secret | `prepare_migration.sh`, `verify_target.sh` |

Le compte SSH utilisé (`VPS_USER`) doit disposer d'un `sudo` sans mot de passe sur le
VPS pour l'exécution distante via le workflow.

## Workflow GitHub Actions

`.github/workflows/ovh-vps-admin.yml` :

- Déclenchement **uniquement manuel** (`workflow_dispatch`), jamais sur push/PR/schedule.
- Un seul script exécuté par run, choisi via une liste fermée (`type: choice`).
- Les secrets ne sont jamais interpolés directement dans une commande shell : ils
  transitent par des blocs `env:`, puis par un fichier distant en mode `600` sourcé côté
  VPS et supprimé immédiatement après lecture, jamais affichés ni passés en argument.
- `set +x` sur chaque étape pour ne jamais tracer de valeur sensible dans les logs.
- Job rattaché à l'environnement GitHub `ovh-vps-admin` — configurer des règles de
  protection (reviewers requis) côté paramètres du dépôt si souhaité.
- Pour `harden_ssh.sh`, il faut saisir manuellement `HARDEN_SSH` dans l'input
  `confirm_harden_ssh` à chaque exécution — sinon le script refuse de s'exécuter.
- Pour `verify_target.sh`, renseigner l'input `staging_db` avec le nom généré par
  `prepare_migration.sh` (fichier `staging_db_name.txt` du dossier de migration).

## Ce que ce workflow ne fait jamais

- Il ne touche pas à `main`.
- Il ne bascule jamais la production.
- Il ne modifie jamais Supabase (lecture seule stricte côté source).
- Il ne s'exécute jamais automatiquement (aucun trigger `push`/`pull_request`/`schedule`).
