/**
 * PHOTO-P0 — Consignes de tri en langage naturel → (kind, keyword).
 *
 * Pur, sans DOM, sans réseau, sans LLM. C'est de la NORMALISATION d'entrée, pas
 * une décision : la façade `record_photo_culling_instruction` re-valide le kind
 * et borne le mot-clé, et seul `derive_photo_culling_verdicts` applique la
 * consigne. Cette fonction ne peut donc rien écarter par elle-même.
 *
 * RÈGLE DE SÛRETÉ NON NÉGOCIABLE — biais protecteur :
 *   * un doute ⇒ `null` (l'UI demande de choisir explicitement) ;
 *   * jamais de repli implicite vers `EXCLUDE`. Une phrase mal comprise ne doit
 *     jamais pouvoir aboutir à écarter des photos ;
 *   * la négation d'un verbe d'exclusion (« ne supprime aucune photo de X »)
 *     est lue comme `PROTECT`, jamais comme `EXCLUDE`.
 */

export type InstructionKind = "PROTECT" | "PREFER" | "EXCLUDE";

export type ParsedInstruction = {
  kind: InstructionKind;
  keyword: string;
};

/** Mots vides retirés en tête de mot-clé (articles, possessifs, quantifieurs). */
const LEADING_STOPWORDS = new Set([
  "le", "la", "les", "l", "un", "une", "des", "du", "de", "d",
  "mon", "ma", "mes", "son", "sa", "ses", "leur", "leurs", "notre", "nos",
  "toutes", "tous", "toute", "tout", "aucune", "aucun",
  "photo", "photos", "cliche", "cliches", "image", "images",
]);

// Frontières de mot UNICODE. `\b` de JS ne considère que [A-Za-z0-9_] : il échoue
// donc juste avant « écarte » ou « élimine ». Les lookarounds `\p{L}` corrigent ce
// piège — sans quoi une consigne d'exclusion accentuée passerait inaperçue.
const WORD_START = "(?<!\\p{L})";
const WORD_END = "(?!\\p{L})";
const verbs = (pattern: string): RegExp =>
  new RegExp(`${WORD_START}(?:${pattern})${WORD_END}`, "iu");

/** Verbes de protection : « garde », « conserve », « protège »… */
const PROTECT_VERBS = verbs("garde[rsz]?|conserve[rsz]?|prot[eè]ge[rsz]?|sauvegarde[rsz]?");
/** Verbes de préférence : « privilégie », « préfère », « favorise »… */
const PREFER_VERBS = verbs(
  "privil[eé]gie[rsz]?|pr[eé]f[eè]re[rsz]?|favorise[rsz]?|mets? en avant",
);
/** Verbes d'exclusion : « écarte », « retire », « exclus », « supprime »… */
const EXCLUDE_VERBS = verbs(
  "[eé]carte[rsz]?|[eé]limine[rsz]?|retire[rsz]?|exclu[erst]*|enl[eè]ve[rsz]?|supprime[rsz]?|jette[rsz]?",
);
/** Négation française encadrant un verbe (« ne … pas / aucune / jamais / plus »). */
const NEGATION = /(?<!\p{L})n[e']?(?!\p{L})[^.!?]{0,40}?(?<!\p{L})(pas|aucune?|jamais|plus|rien)(?!\p{L})/iu;

/** Normalise les accents et la casse pour la comparaison des mots vides. */
function fold(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Extrait le sujet de la consigne : le texte après le dernier « de / des / du /
 * d' », ou entre guillemets si l'utilisateur en a mis. Les mots vides de tête
 * sont retirés, la ponctuation finale aussi.
 */
export function extractKeyword(text: string): string | null {
  // Un sujet explicitement cité est pris TEL QUEL : la photographe a déjà dit
  // exactement ce qu'elle visait, il n'y a rien à nettoyer.
  const quoted = text.match(/[«"']([^«»"']{1,100})[»"']/);
  if (quoted) {
    const exact = quoted[1].trim();
    return exact.length > 0 && exact.length <= 100 ? exact : null;
  }

  let candidate: string | null = null;
  {
    const after = text.match(/\b(?:de(?:s)?|du|d['’])\s+(.{1,100})$/i);
    candidate = after ? after[1] : null;
  }
  if (!candidate) {
    // Dernier recours : les mots après le verbe reconnu.
    const verb = text.match(
      /\b(?:garde[rz]?|conserve[rz]?|prot[eè]ge[rz]?|privil[eé]gie[rz]?|pr[eé]f[eè]re[rz]?|favorise[rz]?|[eé]carte[rz]?|retire[rz]?|exclus?|enl[eè]ve[rz]?|supprime[rz]?)\s+(.{1,100})$/i,
    );
    candidate = verb ? verb[1] : null;
  }
  if (!candidate) return null;

  let words = candidate
    .replace(/[.!?,;:]+\s*$/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 0);

  while (words.length > 0 && LEADING_STOPWORDS.has(fold(words[0]).replace(/['’]$/, ""))) {
    words = words.slice(1);
  }

  const keyword = words.join(" ").trim();
  if (keyword.length === 0 || keyword.length > 100) return null;
  return keyword;
}

/**
 * Classe une consigne libre. Renvoie `null` dès qu'il y a ambiguïté — l'UI
 * bascule alors sur un choix explicite plutôt que de deviner.
 */
export function parseCullingInstruction(input: string): ParsedInstruction | null {
  const text = (input ?? "").trim();
  if (text.length === 0 || text.length > 500) return null;

  const hasProtect = PROTECT_VERBS.test(text);
  const hasPrefer = PREFER_VERBS.test(text);
  const hasExclude = EXCLUDE_VERBS.test(text);
  const negated = NEGATION.test(text);

  let kind: InstructionKind | null = null;

  if (negated && hasExclude) {
    // « ne supprime aucune photo des grands-parents » ⇒ protection.
    kind = "PROTECT";
  } else if (negated && (hasProtect || hasPrefer)) {
    // « ne garde pas … » : intention d'exclusion exprimée par la négation d'une
    // protection. Trop risqué pour être deviné ⇒ choix explicite demandé.
    kind = null;
  } else if (hasProtect && !hasExclude) {
    kind = "PROTECT";
  } else if (hasPrefer && !hasExclude && !hasProtect) {
    kind = "PREFER";
  } else if (hasExclude && !hasProtect && !hasPrefer) {
    kind = "EXCLUDE";
  } else {
    kind = null;
  }

  if (kind === null) return null;

  const keyword = extractKeyword(text);
  if (!keyword) return null;

  return { kind, keyword };
}

/** Libellés d'affichage (FR) des trois natures de consigne. */
export const INSTRUCTION_KIND_LABEL: Record<InstructionKind, string> = {
  PROTECT: "Protéger",
  PREFER: "Privilégier",
  EXCLUDE: "Écarter",
};
