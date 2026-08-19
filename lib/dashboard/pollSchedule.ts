/**
 * PHASE 2 — cadence de sondage du gateway (pure, sans I/O, sans DOM).
 *
 * PROBLÈME MESURÉ. Les panneaux sondaient `pollAgentActionResultAction` à
 * intervalle FIXE de 1,5 s : 200 tentatives pour le suivi d'action du chat
 * (~5 min), 40 pour les autres (~1 min). Or aucun consumer n8n ne draine la
 * file — les 11 requêtes réelles sont `QUEUED` depuis le 10 août. Chaque action
 * déclenchait donc jusqu'à **200 allers-retours RPC garantis inutiles** avant
 * d'abandonner.
 *
 * CAUSE RACINE. Un intervalle fixe suppose que la réponse arrive « bientôt ».
 * Quand la file est froide, cette hypothèse est fausse et le coût est linéaire
 * dans le temps d'attente. La cadence doit dépendre du temps déjà attendu.
 *
 * CORRECTIF. Recul exponentiel borné, à FENÊTRE D'ATTENTE INCHANGÉE : on
 * conserve exactement le même budget de temps mural (une action approuvée dans
 * le panneau Approbations reprend toujours dans la conversation), mais le
 * nombre de requêtes s'effondre.
 *
 *   budget 300 s : 200 tentatives -> 19   (-90 %)
 *   budget  60 s :  40 tentatives ->  7   (-82 %)
 *
 * Aucune sémantique n'est modifiée : mêmes statuts terminaux, même abandon en
 * fin de budget. Seule la RÉPARTITION des tentatives change.
 */

export type PollSchedule = {
  /** Délai avant la 1re tentative (ms). */
  baseMs: number;
  /** Plafond d'un délai individuel (ms) — au-delà, la cadence est constante. */
  maxMs: number;
  /** Facteur de croissance entre deux tentatives. */
  factor: number;
};

/** Cadence par défaut : démarre réactif, plafonne à 20 s. */
export const DEFAULT_POLL_SCHEDULE: PollSchedule = {
  baseMs: 1500,
  maxMs: 20000,
  factor: 1.6,
};

function schedule(partial?: Partial<PollSchedule>): PollSchedule {
  const s = { ...DEFAULT_POLL_SCHEDULE, ...(partial ?? {}) };
  return {
    baseMs: Math.max(1, Math.floor(s.baseMs)),
    maxMs: Math.max(1, Math.floor(s.maxMs)),
    factor: s.factor >= 1 ? s.factor : 1,
  };
}

/**
 * Délai avant la tentative `attempt` (0-indexée : 0 = première).
 * Croissance géométrique bornée par `maxMs`. Un `attempt` négatif ou non fini
 * est ramené à 0 — la fonction ne renvoie JAMAIS NaN ni une valeur négative,
 * ce qui rendrait un `setTimeout` immédiat et reproduirait le martèlement.
 */
export function pollDelayMs(attempt: number, partial?: Partial<PollSchedule>): number {
  const s = schedule(partial);
  const n = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  const raw = s.baseMs * Math.pow(s.factor, n);
  if (!Number.isFinite(raw)) return s.maxMs;
  return Math.min(s.maxMs, Math.max(s.baseMs, Math.round(raw)));
}

/** Temps mural cumulé après `attempts` tentatives (ms). */
export function elapsedMsAfter(attempts: number, partial?: Partial<PollSchedule>): number {
  const n = Number.isFinite(attempts) && attempts > 0 ? Math.floor(attempts) : 0;
  let total = 0;
  for (let i = 0; i < n; i += 1) total += pollDelayMs(i, partial);
  return total;
}

/**
 * Nombre de tentatives tenant dans `budgetMs`. C'est le remplaçant direct des
 * anciens `max = 200` / `maxAttempts = 40` : on exprime désormais la limite en
 * TEMPS (l'intention réelle) plutôt qu'en nombre de requêtes (l'effet de bord).
 */
export function attemptsWithinBudget(
  budgetMs: number,
  partial?: Partial<PollSchedule>,
): number {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) return 0;
  let total = 0;
  let n = 0;
  // Borne dure : même une cadence dégénérée ne peut pas produire une boucle
  // infinie ici (maxMs >= 1 garantit une progression, la borne est une ceinture).
  while (n < 10000) {
    const next = total + pollDelayMs(n, partial);
    if (next > budgetMs) break;
    total = next;
    n += 1;
  }
  return n;
}

/** Budgets d'attente, en un seul endroit — la fenêtre métier, pas la cadence. */
export const POLL_BUDGET_MS = {
  /** Suivi d'une action dans le chat : couvre une approbation humaine. */
  action: 300_000,
  /** Formulaire / reprise après approbation : retour rapide attendu. */
  form: 60_000,
} as const;
