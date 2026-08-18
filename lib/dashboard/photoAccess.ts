/**
 * PHOTO-P0 — Portillon d'accès à la verticale Hermès Studio (pur, sans I/O).
 *
 * Problème résolu ici : le moteur capability-first du dashboard raisonne sur les
 * ACTIONS accordées (`get_available_capabilities`), or toutes les actions photo
 * sont volontairement DORMANTES (`enabled = false`) tant que leurs runners n8n
 * n'existent pas. Sans passerelle, la verticale serait donc invisible même une
 * fois installée chez une photographe.
 *
 * Solution : une clé SYNTHÉTIQUE `photo.studio`, ajoutée à l'ensemble servant aux
 * portillons (widgets, profils, menus) uniquement quand la verticale est activée
 * pour le tenant (`hermes_os.photo_studio_activation.enabled`).
 *
 * Deux ensembles, volontairement distincts :
 *   * les capacités RÉELLES (actions exécutables) → Quick Actions, orchestrateur.
 *     La clé synthétique n'y entre JAMAIS : elle ne rend rien exécutable.
 *   * les clés de PORTILLON (affichage) → widgets, profils, navigation.
 *
 * Conséquence directe et voulue : par défaut, aucune activation ⇒ aucun widget,
 * aucun profil, aucun menu photo. La Phase 1 est inerte à l'installation.
 */

/** Clé synthétique d'activation. Ce n'est PAS une action du catalogue. */
export const PHOTO_STUDIO_CAPABILITY_KEY = "photo.studio";

/** Préfixe des capacités photo, utilisé par les portillons de widgets/profils. */
export const PHOTO_CAPABILITY_PREFIX = "photo.";

/**
 * Ensemble des clés utilisées pour les PORTILLONS D'AFFICHAGE.
 * Retourne un nouvel ensemble ; l'entrée n'est jamais mutée.
 */
export function photoGateKeys(
  capabilityKeys: Iterable<string>,
  moduleEnabled: boolean,
): Set<string> {
  const out = new Set<string>(capabilityKeys);
  if (moduleEnabled) out.add(PHOTO_STUDIO_CAPABILITY_KEY);
  return out;
}

/** Le tenant a-t-il accès à la verticale ? (portillon unique, réutilisé partout) */
export function hasPhotoStudio(gateKeys: Set<string>): boolean {
  for (const key of gateKeys) {
    if (key.startsWith(PHOTO_CAPABILITY_PREFIX)) return true;
  }
  return false;
}
