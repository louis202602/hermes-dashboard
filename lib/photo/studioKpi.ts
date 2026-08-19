/**
 * HERMÈS STUDIO — les 14 KPI du tableau de bord.
 *
 * « Aucun KPI inventé par LLM » ne se garantit pas par une consigne : ça se
 * garantit en rendant l'invention IMPOSSIBLE. Chaque indicateur déclare donc
 * ici sa SOURCE exacte — table et colonne réelles — et son mode de calcul.
 * Un indicateur sans source ne peut pas exister : le registre ne compile pas.
 *
 * La deuxième règle est tout aussi importante, et c'est celle qu'on oublie :
 * **un dénominateur nul rend `null`, jamais 0.** « 0 % d'acceptation de devis »
 * quand aucun devis n'est parti est un chiffre faux, et un chiffre faux dans un
 * tableau de bord est pire qu'une case vide — on prend des décisions dessus.
 *
 * Pur, sans I/O.
 */

export const STUDIO_KPI_KEYS = [
  "new_leads",
  "qualification_rate",
  "quotes_sent",
  "quote_acceptance_rate",
  "contracts_signed",
  "deposits_collected_eur",
  "bookings_confirmed",
  "missed_calls_recovered",
  "booked_revenue_eur",
  "collected_revenue_eur",
  "upsell_revenue_eur",
  "recurring_clients",
  "revenue_per_client_eur",
  "revenue_per_source_eur",
] as const;
export type StudioKpiKey = (typeof STUDIO_KPI_KEYS)[number];

export type KpiKind = "COUNT" | "RATIO" | "AMOUNT_EUR" | "BREAKDOWN";

export type StudioKpiDef = {
  key: StudioKpiKey;
  label: string;
  kind: KpiKind;
  /** Table(s) réelle(s) d'où sort le chiffre. Jamais « estimé », jamais « IA ». */
  sources: string[];
  /** Formule en clair, vérifiable à la lecture. */
  formula: string;
  /**
   * `true` ⇒ l'indicateur peut valoir `null` (non mesuré). Tout ratio et tout
   * montant dépendant d'un fait externe (encaissement) est dans ce cas.
   */
  nullable: boolean;
};

export const STUDIO_KPI_REGISTRY: StudioKpiDef[] = [
  {
    key: "new_leads",
    label: "Nouveaux prospects",
    kind: "COUNT",
    sources: ["photo_leads"],
    formula: "count(photo_leads) sur la période",
    nullable: false,
  },
  {
    key: "qualification_rate",
    label: "Taux de qualification",
    kind: "RATIO",
    sources: ["photo_leads"],
    formula: "leads status ∈ {QUALIFIED,QUOTED,BOOKED,PAID} ÷ leads créés",
    nullable: true,
  },
  {
    key: "quotes_sent",
    label: "Devis envoyés",
    kind: "COUNT",
    sources: ["photo_quotes"],
    formula: "count(photo_quotes où state ≠ QUOTE_DRAFT)",
    nullable: false,
  },
  {
    key: "quote_acceptance_rate",
    label: "Taux d'acceptation des devis",
    kind: "RATIO",
    sources: ["photo_quotes"],
    formula: "devis QUOTE_ACCEPTED ÷ devis envoyés",
    nullable: true,
  },
  {
    key: "contracts_signed",
    label: "Contrats signés",
    kind: "COUNT",
    sources: ["photo_contracts"],
    formula: "count(photo_contracts où signed_at is not null)",
    nullable: false,
  },
  {
    key: "deposits_collected_eur",
    label: "Acomptes encaissés",
    kind: "AMOUNT_EUR",
    sources: ["photo_payments"],
    formula: "somme(amount_eur) où kind=DEPOSIT et status=PAID et verified_at is not null",
    nullable: true,
  },
  {
    key: "bookings_confirmed",
    label: "Réservations confirmées",
    kind: "COUNT",
    sources: ["photo_quotes", "photo_sessions"],
    formula: "count(state = BOOKING_CONFIRMED)",
    nullable: false,
  },
  {
    key: "missed_calls_recovered",
    label: "Appels manqués récupérés",
    kind: "COUNT",
    sources: ["photo_calls", "photo_lead_events"],
    formula: "appels ABANDONED ayant produit un lead avec au moins une réponse entrante",
    nullable: false,
  },
  {
    key: "booked_revenue_eur",
    label: "CA réservé",
    kind: "AMOUNT_EUR",
    sources: ["photo_quotes"],
    formula: "somme(total_eur) des devis en BOOKING_CONFIRMED — engagé, pas encaissé",
    nullable: true,
  },
  {
    key: "collected_revenue_eur",
    label: "CA encaissé",
    kind: "AMOUNT_EUR",
    sources: ["photo_payments"],
    formula: "somme(amount_eur) où status=PAID et verified_at is not null",
    nullable: true,
  },
  {
    key: "upsell_revenue_eur",
    label: "CA additionnel (upsell)",
    kind: "AMOUNT_EUR",
    sources: ["photo_upsell_opportunities"],
    formula: "somme(revenue_generated_eur) où status=ACCEPTED",
    nullable: true,
  },
  {
    key: "recurring_clients",
    label: "Clients récurrents",
    kind: "COUNT",
    sources: ["photo_sessions"],
    formula: "clients ayant ≥ 2 séances distinctes livrées",
    nullable: false,
  },
  {
    key: "revenue_per_client_eur",
    label: "Revenu par client",
    kind: "AMOUNT_EUR",
    sources: ["photo_payments", "photo_clients"],
    formula: "CA encaissé ÷ clients ayant payé",
    nullable: true,
  },
  {
    key: "revenue_per_source_eur",
    label: "Revenu par source",
    kind: "BREAKDOWN",
    sources: ["photo_leads", "photo_payments"],
    formula: "CA encaissé regroupé par photo_leads.source",
    nullable: true,
  },
];

const KPI_BY_KEY = new Map<StudioKpiKey, StudioKpiDef>(
  STUDIO_KPI_REGISTRY.map((k) => [k.key, k]),
);

export function studioKpiDef(key: StudioKpiKey): StudioKpiDef | undefined {
  return KPI_BY_KEY.get(key);
}

/**
 * Ratio honnête. Dénominateur nul ⇒ `null`, PAS 0.
 * Un numérateur supérieur au dénominateur rend `null` aussi : c'est un signe
 * que les deux comptages ne portent pas sur la même population, et publier
 * « 140 % » vaut moins que publier « non mesuré ».
 */
export function kpiRatio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator <= 0) return null;
  if (numerator < 0 || numerator > denominator) return null;
  return numerator / denominator;
}

/**
 * Montant honnête. `null` quand rien n'a été mesuré — un CA de 0 € affiché
 * alors qu'aucun paiement n'a encore été rapporté est un mensonge par omission.
 */
export function kpiAmount(sum: number | null, measuredCount: number): number | null {
  if (measuredCount <= 0) return null;
  if (typeof sum !== "number" || !Number.isFinite(sum)) return null;
  return Math.round(sum * 100) / 100;
}

/** Les KPI qui ont le droit de valoir `null` (non mesuré). */
export function nullableKpiKeys(): StudioKpiKey[] {
  return STUDIO_KPI_REGISTRY.filter((k) => k.nullable).map((k) => k.key);
}

/**
 * KPI non mesurés à ce jour. Sert à afficher « non mesuré » explicitement dans
 * le tableau de bord plutôt qu'à laisser une case vide qu'on lira comme un zéro.
 */
export function unmeasuredKpis(
  values: Partial<Record<StudioKpiKey, number | null>>,
): StudioKpiKey[] {
  return nullableKpiKeys().filter((k) => values[k] == null);
}
