/**
 * HERMÈS STUDIO — adaptateurs PAIEMENT et SIGNATURE.
 *
 * Aucun prestataire réel n'est branché. Ce module définit la FORME que doit
 * prendre n'importe lequel, et — c'est le point — ce qu'aucun ne pourra faire.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ UN PRESTATAIRE NE CONFIRME JAMAIS UNE RÉSERVATION.                       │
 * │ Il rapporte un fait. La base décide.                                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * C'est plus qu'une formulation. Un webhook Stripe qui dit « payé » ne peut pas
 * faire passer un devis en `BOOKING_CONFIRMED` : il écrit une ligne dans
 * `photo_payments`, et la contrainte `photo_payment_paid_is_verified` puis le
 * trigger `photo_quote_guard` décident — contrat signé ? montant suffisant ?
 * transition légale ? Un prestataire compromis, ou simplement bavard, ne peut
 * donc pas offrir une date.
 *
 * Le rôle d'un adaptateur est étroit et unique : traduire la charge utile d'un
 * fournisseur en un FAIT VÉRIFIÉ, ou refuser. Il ne décide rien d'autre.
 *
 * Pur, sans I/O, sans dépendance à un SDK. Ajouter un prestataire = ajouter une
 * fonction de normalisation ; rien d'autre ne bouge.
 */

import type { VerifiedFact } from "@/lib/photo/booking";

// --- Vocabulaire commun --------------------------------------------------------

export const ADAPTER_REFUSAL_CODES = [
  "UNKNOWN_PROVIDER",
  "MALFORMED_PAYLOAD",
  "MISSING_REFERENCE",
  "MISSING_TIMESTAMP",
  "UNPARSABLE_TIMESTAMP",
  "NOT_SUCCESSFUL",
  "AMOUNT_INVALID",
  "CURRENCY_UNSUPPORTED",
  "SIGNATURE_NOT_TRACEABLE",
] as const;
export type AdapterRefusalCode = (typeof ADAPTER_REFUSAL_CODES)[number];

export const SUPPORTED_CURRENCIES = ["EUR", "USD", "GBP"] as const;

/** `null` ⇒ absent ou illisible. On ne rend jamais une date approximative. */
function parseInstant(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "number" && Number.isFinite(v)) {
    // Les prestataires envoient des secondes Unix ; JavaScript attend des ms.
    const d = new Date(v > 1e12 ? v : v * 1000);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "string" && v.length > 0) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function nonEmptyString(v: unknown, max = 200): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
}

// ═══ PAIEMENT ═══════════════════════════════════════════════════════════════

/** Statuts de `photo_payments`. Aucun autre n'existe. */
export type PaymentStatus = "PENDING" | "PAID" | "FAILED" | "REFUNDED" | "CANCELLED";

export type NormalizedPayment = {
  providerReference: string;
  providerEventId: string;
  amountEur: number;
  currency: string;
  status: PaymentStatus;
  verifiedAt: Date;
  kind: "DEPOSIT" | "BALANCE" | "UPSELL" | "REFUND" | "OTHER";
  /** Le fait tel que `canConfirmBooking` l'exige. Toujours `VERIFIED` ici. */
  fact: VerifiedFact;
};

export type PaymentAdapterResult =
  | { ok: true; payment: NormalizedPayment }
  | { ok: false; code: AdapterRefusalCode };

export type PaymentAdapter = {
  provider: string;
  /** `false` tant qu'aucun compte n'est ouvert. Déclaré ≠ prêt. */
  implemented: boolean;
  normalize: (payload: unknown) => PaymentAdapterResult;
};

/**
 * Normalisation générique — la forme que TOUT prestataire doit satisfaire.
 *
 * Refuse plutôt que de compléter :
 *   * pas de référence opposable ⇒ refus (sans elle, aucun rapprochement) ;
 *   * pas d'horodatage de vérification ⇒ refus (« payé » sans quand n'est pas
 *     un fait, c'est une affirmation) ;
 *   * statut autre que réussi ⇒ refus (`PENDING` n'est pas `PAID`) ;
 *   * devise non gérée ⇒ refus (`sw19_cost_events` n'en accepte que trois, et
 *     convertir ici inventerait un taux).
 */
export function normalizePayment(
  payload: unknown,
  map: {
    reference: string;
    eventId: string;
    amount: string;
    currency: string;
    status: string;
    verifiedAt: string;
    successValues: string[];
    /** Le montant est-il exprimé en centimes ? (cas de Stripe) */
    amountInMinorUnits: boolean;
  },
): PaymentAdapterResult {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, code: "MALFORMED_PAYLOAD" };
  }
  const p = payload as Record<string, unknown>;

  const reference = nonEmptyString(p[map.reference]);
  if (!reference) return { ok: false, code: "MISSING_REFERENCE" };

  const eventId = nonEmptyString(p[map.eventId]) ?? reference;

  const rawStatus = typeof p[map.status] === "string" ? (p[map.status] as string) : "";
  if (!map.successValues.includes(rawStatus)) return { ok: false, code: "NOT_SUCCESSFUL" };

  const rawAmount = p[map.amount];
  if (typeof rawAmount !== "number" || !Number.isFinite(rawAmount) || rawAmount < 0) {
    return { ok: false, code: "AMOUNT_INVALID" };
  }
  const amountEur = map.amountInMinorUnits ? Math.round(rawAmount) / 100 : rawAmount;

  const currency = (nonEmptyString(p[map.currency], 3) ?? "").toUpperCase();
  if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(currency)) {
    return { ok: false, code: "CURRENCY_UNSUPPORTED" };
  }

  const verifiedAt = parseInstant(p[map.verifiedAt]);
  if (verifiedAt === null) {
    return {
      ok: false,
      code: p[map.verifiedAt] === undefined ? "MISSING_TIMESTAMP" : "UNPARSABLE_TIMESTAMP",
    };
  }

  return {
    ok: true,
    payment: {
      providerReference: reference,
      providerEventId: eventId,
      amountEur,
      currency,
      status: "PAID",
      verifiedAt,
      kind: "DEPOSIT",
      fact: { provenance: "VERIFIED", at: verifiedAt, reference },
    },
  };
}

/**
 * Prestataires de paiement DÉCLARÉS. Aucun n'est implémenté — la forme est
 * prête, le compte n'existe pas. `implemented: false` est la vérité, pas une
 * précaution : brancher l'un d'eux est une décision à prendre, pas un oubli.
 */
export const PAYMENT_ADAPTERS: PaymentAdapter[] = [
  {
    provider: "stripe",
    implemented: false,
    normalize: (payload) =>
      normalizePayment(payload, {
        reference: "id",
        eventId: "id",
        amount: "amount_received",
        currency: "currency",
        status: "status",
        verifiedAt: "created",
        successValues: ["succeeded"],
        amountInMinorUnits: true,
      }),
  },
  {
    // Virement saisi à la main par la photographe : le « prestataire » est elle.
    // La référence est celle du relevé bancaire — opposable, donc admissible.
    provider: "manual_transfer",
    implemented: false,
    normalize: (payload) =>
      normalizePayment(payload, {
        reference: "bank_reference",
        eventId: "bank_reference",
        amount: "amount_eur",
        currency: "currency",
        status: "status",
        verifiedAt: "value_date",
        successValues: ["RECEIVED"],
        amountInMinorUnits: false,
      }),
  },
];

export function paymentAdapter(provider: string): PaymentAdapter | undefined {
  return PAYMENT_ADAPTERS.find((a) => a.provider === provider);
}

export function adaptPayment(provider: string, payload: unknown): PaymentAdapterResult {
  const adapter = paymentAdapter(provider);
  if (!adapter) return { ok: false, code: "UNKNOWN_PROVIDER" };
  return adapter.normalize(payload);
}

// ═══ SIGNATURE ══════════════════════════════════════════════════════════════

export type SignatureMethod = "ELECTRONIC" | "HANDWRITTEN" | "CLICKWRAP";

export type NormalizedSignature = {
  providerReference: string;
  signerName: string | null;
  signedAt: Date;
  method: SignatureMethod;
  templateKey: string | null;
  templateVersion: string | null;
  fact: VerifiedFact;
};

export type SignatureAdapterResult =
  | { ok: true; signature: NormalizedSignature }
  | { ok: false; code: AdapterRefusalCode };

export type SignatureAdapter = {
  provider: string;
  implemented: boolean;
  normalize: (payload: unknown) => SignatureAdapterResult;
};

/**
 * Normalisation d'une signature.
 *
 * La contrainte de table `photo_contract_signature_traceable` exige date +
 * méthode + référence pour tout contrat `SIGNED`. Cet adaptateur applique la
 * MÊME exigence en amont, pour que le refus arrive avec un motif lisible plutôt
 * que sous forme d'une violation de contrainte à déchiffrer dans un journal.
 *
 * `signerName` reste facultatif : un prestataire peut ne pas le transmettre, et
 * ce n'est pas ce qui rend une signature opposable. La RÉFÉRENCE l'est.
 */
export function normalizeSignature(
  payload: unknown,
  map: {
    reference: string;
    signerName: string;
    signedAt: string;
    method: string;
    templateKey: string;
    templateVersion: string;
    status: string;
    successValues: string[];
    methodValues: Record<string, SignatureMethod>;
  },
): SignatureAdapterResult {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, code: "MALFORMED_PAYLOAD" };
  }
  const p = payload as Record<string, unknown>;

  const rawStatus = typeof p[map.status] === "string" ? (p[map.status] as string) : "";
  if (!map.successValues.includes(rawStatus)) return { ok: false, code: "NOT_SUCCESSFUL" };

  const reference = nonEmptyString(p[map.reference]);
  if (!reference) return { ok: false, code: "MISSING_REFERENCE" };

  const signedAt = parseInstant(p[map.signedAt]);
  if (signedAt === null) {
    return {
      ok: false,
      code: p[map.signedAt] === undefined ? "MISSING_TIMESTAMP" : "UNPARSABLE_TIMESTAMP",
    };
  }

  const rawMethod = typeof p[map.method] === "string" ? (p[map.method] as string) : "";
  const method = map.methodValues[rawMethod];
  if (!method) return { ok: false, code: "SIGNATURE_NOT_TRACEABLE" };

  return {
    ok: true,
    signature: {
      providerReference: reference,
      signerName: nonEmptyString(p[map.signerName]),
      signedAt,
      method,
      templateKey: nonEmptyString(p[map.templateKey], 80),
      templateVersion: nonEmptyString(p[map.templateVersion], 40),
      fact: { provenance: "VERIFIED", at: signedAt, reference },
    },
  };
}

export const SIGNATURE_ADAPTERS: SignatureAdapter[] = [
  {
    provider: "yousign",
    implemented: false,
    normalize: (payload) =>
      normalizeSignature(payload, {
        reference: "signature_request_id",
        signerName: "signer_full_name",
        signedAt: "signed_at",
        method: "signature_level",
        templateKey: "template_id",
        templateVersion: "template_version",
        status: "status",
        successValues: ["done", "signed"],
        methodValues: {
          electronic_signature: "ELECTRONIC",
          advanced_electronic_signature: "ELECTRONIC",
          simple: "CLICKWRAP",
        },
      }),
  },
  {
    provider: "docusign",
    implemented: false,
    normalize: (payload) =>
      normalizeSignature(payload, {
        reference: "envelopeId",
        signerName: "signerName",
        signedAt: "completedDateTime",
        method: "signatureType",
        templateKey: "templateId",
        templateVersion: "templateVersion",
        status: "status",
        successValues: ["completed"],
        methodValues: { electronic: "ELECTRONIC", drawn: "HANDWRITTEN", clickwrap: "CLICKWRAP" },
      }),
  },
];

export function signatureAdapter(provider: string): SignatureAdapter | undefined {
  return SIGNATURE_ADAPTERS.find((a) => a.provider === provider);
}

export function adaptSignature(provider: string, payload: unknown): SignatureAdapterResult {
  const adapter = signatureAdapter(provider);
  if (!adapter) return { ok: false, code: "UNKNOWN_PROVIDER" };
  return adapter.normalize(payload);
}

/**
 * Y a-t-il un prestataire opérationnel ?
 *
 * Répond NON aujourd'hui, pour les deux familles. C'est volontairement exposé :
 * un tableau de bord qui affiche « paiement en attente » sans qu'aucun
 * encaissement ne soit possible ment à la photographe.
 */
export function providerReadiness(): {
  payment: { declared: number; implemented: number };
  signature: { declared: number; implemented: number };
  codeRequiresProvider: false;
} {
  return {
    payment: {
      declared: PAYMENT_ADAPTERS.length,
      implemented: PAYMENT_ADAPTERS.filter((a) => a.implemented).length,
    },
    signature: {
      declared: SIGNATURE_ADAPTERS.length,
      implemented: SIGNATURE_ADAPTERS.filter((a) => a.implemented).length,
    },
    // Le CODE ne dépend d'aucun prestataire : la machine d'états, les
    // contraintes et le trigger fonctionnent sans. Choisir un prestataire est
    // une décision commerciale, pas un prérequis technique.
    codeRequiresProvider: false,
  };
}
