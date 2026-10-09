# pg_hba.conf — proposition (NON APPLIQUÉE) : refuser staging_authenticator sur la base de production

Constat : `pg_hba.conf` de hermes-vps-new autorise tout rôle en `scram` sur 127.0.0.1 ; `staging_authenticator` peut donc se connecter à `hermes_os` (production).
Test sur la copie jetable : avec les deux lignes ci-dessous, la connexion TCP `staging_authenticator → hermes_os` est refusée (`pg_hba.conf rejects connection`), `staging_authenticator → postgres` (base d'amorçage) reste possible, et PostgREST de production (rôle `authenticator`) fonctionne sans changement.

À insérer **avant** la première règle `host` générique de `/etc/postgresql/17/main/pg_hba.conf` :

```
host    hermes_os       staging_authenticator   127.0.0.1/32    reject
host    hermes_os       staging_authenticator   ::1/128         reject
```

Application : `sudo -u postgres psql -c "select pg_reload_conf()"` (rechargement, pas de redémarrage).
Retour arrière : supprimer les deux lignes puis recharger.
Avant application réelle : vérifier que le PostgREST de staging (port 9997) ne se connecte pas à `hermes_os` — il doit utiliser la base `hermes_os_staging_*`.
Aucun secret dans ce document.
