export const EINVOICING_NICHE_ID = "facturation_electronique_fr_v1" as const;

export type ProspectEvidence = {
  companyIdentityStatus: boolean;
  activity: boolean;
  officialOrCorroboratedDomain: boolean;
  professionalContact: boolean;
};

export type EinvoicingProspectSignals = {
  employeeCount?: number | null;
  clearB2b?: boolean;
  recurringInvoicingProbable?: boolean;
  prioritySector?: boolean;
  verifiedCompanyWebsite?: boolean;
  verifiedProfessionalEmail?: boolean;
  decisionMakerIdentified?: boolean;
  softwareAbsentLegacyOrUnclear?: boolean;
  adminOrDigitalHelpSignal?: boolean;
  evidence: ProspectEvidence;
  doNotContact?: boolean;
};

export type EinvoicingTier = "P1" | "P2" | "P3" | "REJECT" | "REVIEW";

export type ScoreResult = {
  nicheId: typeof EINVOICING_NICHE_ID;
  score: number;
  tier: EinvoicingTier;
  hardFail: boolean;
  reasons: string[];
};

function hasCriticalEvidence(e: ProspectEvidence): boolean {
  return e.companyIdentityStatus && e.activity && e.officialOrCorroboratedDomain && e.professionalContact;
}

export function scoreEinvoicingProspect(input: EinvoicingProspectSignals): ScoreResult {
  const reasons: string[] = [];

  if (input.doNotContact) {
    return {
      nicheId: EINVOICING_NICHE_ID,
      score: 0,
      tier: "REJECT",
      hardFail: true,
      reasons: ["do_not_contact"],
    };
  }

  if (!hasCriticalEvidence(input.evidence)) {
    return {
      nicheId: EINVOICING_NICHE_ID,
      score: 0,
      tier: "REVIEW",
      hardFail: true,
      reasons: ["critical_evidence_missing"],
    };
  }

  let score = 0;
  const employees = input.employeeCount ?? null;
  if (employees !== null && employees >= 2 && employees <= 50) {
    score += 20;
    reasons.push("employee_band");
  }
  if (input.clearB2b) {
    score += 15;
    reasons.push("clear_b2b");
  }
  if (input.recurringInvoicingProbable) {
    score += 15;
    reasons.push("recurring_invoicing_probable");
  }
  if (input.prioritySector) {
    score += 15;
    reasons.push("priority_sector");
  }
  if (input.verifiedCompanyWebsite) {
    score += 10;
    reasons.push("verified_company_website");
  }
  if (input.verifiedProfessionalEmail) {
    score += 10;
    reasons.push("verified_professional_email");
  }
  if (input.decisionMakerIdentified) {
    score += 5;
    reasons.push("decision_maker_identified");
  }
  if (input.softwareAbsentLegacyOrUnclear) {
    score += 5;
    reasons.push("software_absent_legacy_or_unclear");
  }
  if (input.adminOrDigitalHelpSignal) {
    score += 5;
    reasons.push("admin_or_digital_help_signal");
  }

  const tier: EinvoicingTier = score >= 80 ? "P1" : score >= 65 ? "P2" : score >= 50 ? "P3" : "REJECT";
  return { nicheId: EINVOICING_NICHE_ID, score, tier, hardFail: false, reasons };
}

export type ReplyState =
  | "READY"
  | "INTERESTED"
  | "NOT_READY"
  | "HAS_SOFTWARE"
  | "HAS_PLATFORM"
  | "ACCOUNTANT_HANDLES_IT"
  | "QUESTION"
  | "REFUSAL"
  | "UNSURE";

const NORMALIZE = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function classifyEinvoicingReply(text: string): ReplyState {
  const t = NORMALIZE(text.trim());
  if (!t) return "UNSURE";

  if (/ne plus (me|nous) (contacter|relancer)|ne (me|nous) (contactez|relancez) plus|stop|desabonn|retirez|supprimez|pas interesse|aucun interet|non merci/.test(t)) {
    return "REFUSAL";
  }
  if (/expert[- ]comptable|comptable s.en occupe|cabinet comptable|mon comptable|notre comptable/.test(t)) {
    return "ACCOUNTANT_HANDLES_IT";
  }
  if (/plateforme (agreee|pdp)|nous avons choisi .*plateforme|plateforme (?:est )?deja choisie|deja une plateforme/.test(t)) {
    return "HAS_PLATFORM";
  }
  if (/logiciel de facturation|nous utilisons .*pour factur|on utilise .*pour factur|\berp\b|\bsage\b|\bebp\b|\bpennylane\b|\bsellsy\b|\bciel\b/.test(t)) {
    return "HAS_SOFTWARE";
  }
  if (/deja (pret|prets|configure|configures|operationnel|operationnels)|tout est (pret|configure|operationnel)|nous sommes (prets|configures|operationnels)/.test(t)) {
    return "READY";
  }
  if (/rien (fait|prepare|configure)|pas encore (pret|prets|configure|choisi)|nous n.avons pas commence|on n.a rien fait|aucune plateforme/.test(t)) {
    return "NOT_READY";
  }
  if (/interesse|interessant|appelez|rendez[- ]vous|rdv|envoyez.*info|plus d.information|pouvez[- ]vous m.expliquer|devis|tarif/.test(t)) {
    return "INTERESTED";
  }
  if (/[?]|comment|quand|pourquoi|est[- ]ce que|combien/.test(t)) {
    return "QUESTION";
  }
  return "UNSURE";
}

export function shouldStopOutbound(state: ReplyState): boolean {
  return state === "READY" || state === "REFUSAL";
}
