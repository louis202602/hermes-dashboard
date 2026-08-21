import Link from "next/link";

import {
  PV_ADVISORY_LABELS,
  PV_DEAL_STATE_LABELS,
  PV_REQUIREMENT_LABELS,
  type PvReadiness,
} from "@/lib/pv/readiness";
import {
  PV_PROSPECT_STATUS_LABELS,
  PV_PROSPECT_TYPE_LABELS,
  isHumanCertified,
  pvAzimuthLabel,
  pvBadge,
  pvProspectName,
  pvToneClass,
} from "@/lib/pv/status";
import type { PvDeal } from "@/types/pv";

function v(value: string | number | null | undefined, unit?: string): string {
  if (value === null || value === undefined || value === "") return "—";
  return unit ? `${value} ${unit}` : String(value);
}

/**
 * PV-4 — LA VUE AFFAIRE : tout le dossier en un écran.
 *
 * AUCUNE SOURCE DE VÉRITÉ NOUVELLE. Chaque valeur vient de `get_pv_deal`, qui
 * agrège ce que PV-1 à PV-3 ont posé. Rien n'est recalculé ici, rien n'est
 * complété : un champ absent s'affiche « — ».
 *
 * L'étude et le chiffrage montrés sont les RETENUS, au sens déterministe de la
 * façade : étude VALIDATED de plus haut numéro de version, puis chiffrage
 * VERIFIED de cette étude. Quand il n'y en a pas, l'écran le dit et montre la
 * dernière étude à titre de contexte — clairement étiquetée comme non retenue.
 */
export default function PvDealPanel({
  deal,
  readiness,
}: {
  deal: PvDeal;
  readiness: PvReadiness;
}) {
  const site = deal.site;
  const study = deal.retainedStudy;
  const contextStudy = study === null ? deal.latestStudy : null;
  const econ = deal.retainedEconomics;

  return (
    <>
      <section className="dashboard-card pv-card">
        <div className="dashboard-card-header">
          <div>
            <span className="panel-eyebrow">AFFAIRE PHOTOVOLTAÏQUE</span>
            <h3>{pvProspectName(deal.prospect)}</h3>
          </div>
          <span className={pvToneClass(readiness.state === "READY_FOR_OFFER" ? "certified" : "pending")}>
            {PV_DEAL_STATE_LABELS[readiness.state]}
          </span>
        </div>

        {readiness.missingRequirements.length === 0 ? (
          <p className="photo-note">
            Toutes les conditions sont réunies : étude validée et chiffrage vérifié par un
            humain.
          </p>
        ) : (
          <div className="pv-warning" role="note">
            <strong>Ce qui empêche d’aller plus loin :</strong>
            <ul className="pv-blockers">
              {readiness.missingRequirements.map((r) => (
                <li key={r}>{PV_REQUIREMENT_LABELS[r]}</li>
              ))}
            </ul>
          </div>
        )}

        {/* PV-6 — SIGNALEMENTS, distincts des blocages. Ils n'interdisent rien
            et ne cassent aucun dossier engagé : ils disent ce qui n'est pas
            vérifié. Les confondre avec des blocages ferait passer pour cassé un
            dossier qui ne l'est pas. */}
        {readiness.advisories.length > 0 ? (
          <div className="pv-advisories" role="note">
            <strong>À signaler :</strong>
            <ul className="pv-blockers">
              {readiness.advisories.map((a) => (
                <li key={a}>{PV_ADVISORY_LABELS[a]}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="dashboard-card pv-card">
        <div className="dashboard-card-header">
          <div>
            <span className="panel-eyebrow">AFFAIRE</span>
            <h3>Client</h3>
          </div>
          <Link href={`/etudes/${deal.prospect.id}`} className="photo-badge">
            Fiche prospect
          </Link>
        </div>
        <dl className="pv-facts">
          <div>
            <dt>Type</dt>
            <dd>{PV_PROSPECT_TYPE_LABELS[deal.prospect.prospectType] ?? deal.prospect.prospectType}</dd>
          </div>
          <div>
            <dt>Téléphone</dt>
            <dd>{v(deal.prospect.phone)}</dd>
          </div>
          <div>
            <dt>E-mail</dt>
            <dd>{v(deal.prospect.email)}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{v(deal.prospect.source)}</dd>
          </div>
          <div>
            <dt>Responsable</dt>
            <dd>{v(deal.prospect.ownerUserId)}</dd>
          </div>
          <div>
            <dt>Consentement</dt>
            <dd>
              {deal.prospect.contactConsent
                ? `Oui${deal.prospect.contactConsentAt ? ` — ${deal.prospect.contactConsentAt.slice(0, 10)}` : ""}`
                : "Non"}
            </dd>
          </div>
          <div>
            <dt>Statut commercial</dt>
            <dd>{PV_PROSPECT_STATUS_LABELS[deal.prospect.status] ?? deal.prospect.status}</dd>
          </div>
        </dl>
      </section>

      <section className="dashboard-card pv-card">
        <div className="dashboard-card-header">
          <div>
            <span className="panel-eyebrow">AFFAIRE</span>
            <h3>Site</h3>
          </div>
          {site ? (
            <Link href={`/etudes/sites/${site.id}`} className="photo-badge">
              Ouvrir le site
            </Link>
          ) : null}
        </div>
        {site === null ? (
          <p className="photo-empty">
            Aucun site rattaché. Une étude ne peut exister que sur un site.
          </p>
        ) : (
          <dl className="pv-facts">
            <div>
              <dt>Adresse</dt>
              <dd>{[site.addressLine1, site.postalCode, site.city].filter(Boolean).join(", ") || "—"}</dd>
            </div>
            <div>
              <dt>Bâtiment</dt>
              <dd>{v(site.buildingType)}</dd>
            </div>
            <div>
              <dt>Toiture</dt>
              <dd>{v(site.roofType)}</dd>
            </div>
            <div>
              <dt>Couverture</dt>
              <dd>{v(site.roofMaterial)}</dd>
            </div>
            <div>
              <dt>État</dt>
              <dd>{v(site.roofCondition)}</dd>
            </div>
            <div>
              <dt>Surface totale</dt>
              <dd>{v(site.roofAreaTotalM2, "m²")}</dd>
            </div>
            <div>
              <dt>Surface exploitable</dt>
              <dd>{v(site.roofAreaUsableM2, "m²")}</dd>
            </div>
            <div>
              <dt>Orientation</dt>
              <dd>{v(pvAzimuthLabel(site.azimuthDeg))}</dd>
            </div>
            <div>
              <dt>Inclinaison</dt>
              <dd>{v(site.tiltDeg, "°")}</dd>
            </div>
            <div>
              <dt>Ombrage</dt>
              <dd>{v(site.shadingLevel)}</dd>
            </div>
            <div>
              <dt>Accessibilité</dt>
              <dd>{v(site.accessDifficulty)}</dd>
            </div>
          </dl>
        )}
      </section>

      <section className="dashboard-card pv-card">
        <div className="dashboard-card-header">
          <div>
            <span className="panel-eyebrow">AFFAIRE</span>
            <h3>Consommation</h3>
          </div>
          {deal.consumption ? (
            <span className={pvToneClass(pvBadge(deal.consumption.verificationStatus).tone)}>
              {pvBadge(deal.consumption.verificationStatus).label}
            </span>
          ) : null}
        </div>
        {deal.consumption === null && deal.verifiedBill === null ? (
          <p className="photo-empty">Aucune consommation ni facture vérifiée.</p>
        ) : (
          <dl className="pv-facts">
            <div>
              <dt>Consommation annuelle</dt>
              <dd>{v(deal.consumption?.annualConsumptionKwh ?? null, "kWh")}</dd>
            </div>
            <div>
              <dt>Puissance souscrite</dt>
              <dd>{v(deal.consumption?.subscribedPowerKva ?? null, "kVA")}</dd>
            </div>
            <div>
              <dt>Facture retenue</dt>
              <dd>
                {deal.verifiedBill
                  ? `${deal.verifiedBill.supplier ?? "—"} · ${v(deal.verifiedBill.consumptionKwh, "kWh")}`
                  : "aucune facture vérifiée"}
              </dd>
            </div>
          </dl>
        )}
      </section>

      <section className="dashboard-card pv-card">
        <div className="dashboard-card-header">
          <div>
            <span className="panel-eyebrow">AFFAIRE</span>
            <h3>Étude retenue</h3>
          </div>
          {study ? (
            <span className={pvToneClass(pvBadge(study.status).tone)}>
              {pvBadge(study.status).label}
            </span>
          ) : null}
        </div>

        {study === null ? (
          <>
            <p className="photo-empty">
              Aucune étude retenue : aucune étude n’est validée par un humain.
            </p>
            {contextStudy ? (
              <p className="photo-note">
                Pour information, la dernière étude est la version {contextStudy.version}, en
                statut <strong>{contextStudy.status}</strong>. Elle <strong>n’est pas</strong>{" "}
                retenue — un brouillon ou un calcul ne devient pas la référence du dossier
                parce qu’il est le plus récent.
              </p>
            ) : null}
          </>
        ) : (
          <dl className="pv-facts">
            <div>
              <dt>Version</dt>
              <dd>{study.version}</dd>
            </div>
            <div>
              <dt>Puissance</dt>
              <dd>{v(study.targetPowerKwc, "kWc")}</dd>
            </div>
            <div>
              <dt>Panneaux</dt>
              <dd>
                {v(study.panelCount)}
                {study.panelUnitPowerW !== null ? ` × ${study.panelUnitPowerW} W` : ""}
                {study.panelBrand ? ` · ${study.panelBrand}` : ""}
              </dd>
            </div>
            <div>
              <dt>Onduleur</dt>
              <dd>{[study.inverterType, study.inverterBrand].filter(Boolean).join(" ") || "—"}</dd>
            </div>
            <div>
              <dt>Batterie</dt>
              <dd>{study.hasBattery ? v(study.batteryCapacityKwh, "kWh") : "Non"}</dd>
            </div>
            <div>
              <dt>Production annuelle</dt>
              <dd>{v(study.annualProductionKwh, "kWh")}</dd>
            </div>
            <div>
              <dt>Productible</dt>
              <dd>{v(study.specificYieldKwhKwc, "kWh/kWc")}</dd>
            </div>
            <div>
              <dt>Autoconsommation</dt>
              <dd>{v(study.selfConsumptionRatePct, "%")}</dd>
            </div>
            <div>
              <dt>Autoproduction</dt>
              <dd>{v(study.selfProductionRatePct, "%")}</dd>
            </div>
            <div>
              <dt>Surplus</dt>
              <dd>{v(study.surplusKwh, "kWh")}</dd>
            </div>
            <div>
              <dt>Pertes</dt>
              <dd>{v(study.systemLossesPct, "%")}</dd>
            </div>
          </dl>
        )}
      </section>

      <section className="dashboard-card pv-card">
        <div className="dashboard-card-header">
          <div>
            <span className="panel-eyebrow">AFFAIRE</span>
            <h3>Économie retenue</h3>
          </div>
          {econ ? (
            <span className={pvToneClass(pvBadge(econ.status).tone)}>
              {pvBadge(econ.status).label}
            </span>
          ) : null}
        </div>
        {econ === null ? (
          <p className="photo-empty">
            Aucun chiffrage retenu : aucun chiffrage n’est vérifié sur l’étude retenue.
          </p>
        ) : (
          <>
            {isHumanCertified(econ.status) ? null : (
              <p className="pv-warning" role="note">
                Chiffrage non vérifié — à ne pas transmettre au client en l’état.
              </p>
            )}
            <dl className="pv-facts">
              <div>
                <dt>Investissement HT</dt>
                <dd>{v(econ.investmentHtEur, "€")}</dd>
              </div>
              <div>
                <dt>Investissement TTC</dt>
                <dd>{v(econ.investmentTtcEur, "€")}</dd>
              </div>
              <div>
                <dt>Aides</dt>
                <dd>{v(econ.subsidyTotalEur, "€")}</dd>
              </div>
              <div>
                <dt>Reste à charge</dt>
                <dd>{v(econ.netCostEur, "€")}</dd>
              </div>
              <div>
                <dt>Économies année 1</dt>
                <dd>{v(econ.year1SavingsEur, "€")}</dd>
              </div>
              <div>
                <dt>Revenus surplus</dt>
                <dd>{v(econ.surplusRevenueEur, "€")}</dd>
              </div>
              <div>
                <dt>Gain annuel</dt>
                <dd>{v(econ.annualGainEur, "€")}</dd>
              </div>
              <div>
                <dt>ROI simple</dt>
                <dd>{v(econ.simpleRoiPct, "%")}</dd>
              </div>
              <div>
                <dt>Temps de retour</dt>
                <dd>{v(econ.paybackYears, "ans")}</dd>
              </div>
              <div>
                <dt>VAN</dt>
                <dd>{v(econ.npvEur, "€")}</dd>
              </div>
              <div>
                <dt>TRI</dt>
                <dd>{v(econ.irrPct, "%")}</dd>
              </div>
            </dl>
          </>
        )}
      </section>

      <section className="dashboard-card pv-card">
        <div className="dashboard-card-header">
          <div>
            <span className="panel-eyebrow">AFFAIRE</span>
            <h3>Documents</h3>
          </div>
          <span className="photo-session-meta">
            {deal.documents.length === 0 ? "aucun" : `${deal.documents.length}`}
          </span>
        </div>
        {deal.documents.length === 0 ? (
          <p className="photo-empty">Aucun document rattaché au site.</p>
        ) : (
          <ul className="photo-session-list">
            {deal.documents.map((d) => (
              <li key={d.id} className="photo-session-item">
                <span className="photo-session-main">
                  <strong>{d.originalFilename ?? d.docType}</strong>
                  <span className="photo-session-meta">
                    {d.docType}
                    {d.documentStage !== "SOURCE" ? ` · ${d.documentStage}` : ""} ·{" "}
                    {(d.sizeBytes / 1024).toFixed(0)} Ko
                    {d.uploadedAt ? ` · ${d.uploadedAt.slice(0, 10)}` : ""}
                  </span>
                </span>
                {d.signedUrl ? (
                  <a className="photo-badge" href={d.signedUrl} target="_blank" rel="noreferrer">
                    Ouvrir
                  </a>
                ) : (
                  <span className="photo-session-meta">lien indisponible</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
