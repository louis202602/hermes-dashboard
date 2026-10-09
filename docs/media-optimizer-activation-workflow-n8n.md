# Activation du workflow n8n « HV Media Optimizer → brouillon Buffer » (préparée, NON activée)

Workflow `6L4ab7VEn9rYwHc4`, **inactif**, sur hermes-vps (n8n 2.32.7). Credential Postgres OVH dédié `DYSXoWLQBgAUtE7I`. Le STOP publication reste actif ; le workflow ne crée que des **brouillons** Buffer (saveToDraft), jamais de publication.

## Pré-requis avant activation (tous à valider par Louis)
1. Corrections sécurité (coffre, rôles) appliquées ou explicitement différées.
2. Preview validée (iPhone, Galaxy Tab S9 Ultra, ordinateur).
3. Au moins un média réel avec droits accordés (photos de chantier : voir dossier à partager).
4. STOP `heliosolar` vérifié actif : `select * from public.get_media_optimizer_state()` → `stop=true`.

## Contrôles intégrés (déjà dans le workflow)
Média prêt ? → capacité Buffer → URL média accessible → légende Ollama → règles → brouillon Buffer → relecture → contrôle → enregistrement ; échec : suppression compensatoire du brouillon et marquage de l'échec.

## Activation / retour arrière
- Activer : interface n8n, interrupteur du workflow (ou API `POST /workflows/6L4ab7VEn9rYwHc4/activate`). Déclenchement toutes les 15 min.
- Surveiller la 1re exécution manuellement, puis `social_publications` (aucune ligne `PUBLISHED`).
- Désactiver à tout moment : `POST /workflows/6L4ab7VEn9rYwHc4/deactivate`. Aucun redémarrage requis.
