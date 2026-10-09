# Incident à traiter séparément — ap2-autonomy (Autonomous Prospect)

Périmètre : **Autonomous Prospect**, pas Hermès Visibility OS. Rien n'a été modifié (diagnostic seul).

- Symptôme : `ap2-autonomy.service` (hermes-vps-new) en échec à chaque minute depuis le 2026-10-06 19:01 ; ~57 occurrences/heure le 2026-10-09 07:26 (service `failed`).
- Erreur PostgreSQL : `null value in column "title" of relation "action_item"` (violation NOT NULL).
- Chemin : `ap2.autonomy_tick()` (ligne 11) → `generate_action_items()` (ligne 10, PERFORM d'un upsert d'action de type `commercial_task` / `BID_DEADLINE`) : une tâche commerciale sans titre produit une action sans `title`.
- Cause probable : une ligne de tâche commerciale avec `title` vide ou nul, ou une fonction d'upsert qui ne prévoit pas de titre de repli. À confirmer par le propriétaire du projet.
- Éléments conservés : extrait du journal (60 dernières lignes) dans `~/ap2_incident/journal_tail.txt` sur hermes-vps-new.
- Pistes (non appliquées) : identifier la tâche fautive, lui donner un titre ou ajouter un `coalesce(title, …)` dans l'upsert ; ajouter une alerte pour éviter l'échec silencieux.
- Lien avec Visibility OS : aucun (même serveur et même base seulement).
