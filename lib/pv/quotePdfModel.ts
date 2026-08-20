/**
 * PROJECTION PURE : un devis lu en base → le modèle du PDF.
 *
 * Séparé du constructeur PDF pour la même raison qu'en PV-4 : cette couche est
 * testable sans décoder un seul octet, et c'est ici que se joue la règle qui
 * compte — AUCUNE VALEUR INVENTÉE. Une donnée absente devient `null`, et le
 * document écrit « Non renseigné ». Sur un devis, un zéro fabriqué serait un
 * engagement fabriqué.
 *
 * La ventilation de TVA est RECALCULÉE ici à partir des lignes, avec exactement
 * la même règle qu'en base (regroupement par taux, remise globale appliquée
 * proportionnellement, arrondi une fois par taux). Deux calculs indépendants qui
 * doivent tomber juste : si l'un dérive, un test le voit.
 */

import type { PvQuoteDetail, PvQuoteLine } from "@/types/pv";
import type { PvQuotePdfLine, PvQuotePdfModel } from "@/lib/pv/quotePdf";

/** Un nom de client, ou `null`. Jamais « Client inconnu ». */
export function pvQuoteClientName(
  prospect: { companyName: string | null; firstName: string | null; lastName: string | null } | null,
): string | null {
  if (prospect === null) return null;
  const company = prospect.companyName?.trim() ?? "";
  if (company.length > 0) return company;
  const parts = [prospect.firstName, prospect.lastName]
    .map((p) => p?.trim() ?? "")
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts.join(" ") : null;
}

function siteAddress(
  site: { addressLine1: string | null; postalCode: string | null; city: string | null } | null,
): string | null {
  if (site === null) return null;
  const parts = [site.addressLine1, [site.postalCode, site.city].filter(Boolean).join(" ")]
    .map((p) => (p ?? "").trim())
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Ventilation par taux de TVA. Même règle qu'en base :
 *   base_taux = Σ(total_ligne du taux) × (1 − remise_globale)
 *   tva_taux  = round(base_taux × taux, 2)      ← arrondi UNE fois par taux
 *
 * Arrondir par ligne accumulerait l'erreur : sur vingt lignes à 19,99 €, l'écart
 * se voit sur le total.
 */
export function pvVatBreakdown(
  lines: Pick<PvQuoteLine, "vatRatePct" | "lineTotalHtEur">[],
  discountPct: number,
): { ratePct: number; baseHtEur: number; vatEur: number }[] {
  const factor = 1 - discountPct / 100;
  const byRate = new Map<number, number>();
  for (const l of lines) {
    byRate.set(l.vatRatePct, (byRate.get(l.vatRatePct) ?? 0) + l.lineTotalHtEur);
  }
  return [...byRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ratePct, sum]) => {
      const baseHtEur = Math.round(sum * factor * 100) / 100;
      return {
        ratePct,
        baseHtEur,
        vatEur: Math.round(baseHtEur * (ratePct / 100) * 100) / 100,
      };
    });
}

export function buildPvQuotePdfModel(input: {
  detail: PvQuoteDetail;
  stage: "DRAFT" | "FINAL";
  company: string;
  generatedOn: string;
}): PvQuotePdfModel {
  const { detail, stage, company, generatedOn } = input;
  const q = detail.quote;

  const lines: PvQuotePdfLine[] = detail.lines
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((l) => ({
      position: l.position,
      category: l.category,
      designation: l.designation,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitPriceHtEur: l.unitPriceHtEur,
      vatRatePct: l.vatRatePct,
      discountPct: l.discountPct,
      lineTotalHtEur: l.lineTotalHtEur,
    }));

  const clientName = pvQuoteClientName(detail.prospect);
  const contactParts = [detail.prospect?.phone, detail.prospect?.email]
    .map((p) => (p ?? "").trim())
    .filter((p) => p.length > 0);

  return {
    stage,
    company,
    quoteNumber: q.quoteNumber,
    version: q.version,
    status: q.status,
    // Un devis sans identité client ne peut pas être émis (la base le refuse) ;
    // s'il est imprimé en brouillon, il doit DIRE que le client manque.
    clientName: clientName ?? "Non renseigné",
    clientContact: contactParts.length > 0 ? contactParts.join(" · ") : null,
    siteAddress: siteAddress(detail.site),
    issuedOn: q.issuedOn,
    validUntil: q.validUntil,
    generatedOn,
    currency: q.currency,
    studyReference:
      detail.study === null
        ? "Non renseigné"
        : `version ${detail.study.version} (${detail.study.status})`,
    lines,
    subtotalHtEur: q.subtotalHtEur,
    discountPct: q.discountPct,
    discountAmountEur: q.discountAmountEur,
    totalHtEur: q.totalHtEur,
    totalVatEur: q.totalVatEur,
    totalTtcEur: q.totalTtcEur,
    vatBreakdown: pvVatBreakdown(detail.lines, q.discountPct),
    observations: q.observations,
    terms: q.terms,
  };
}
