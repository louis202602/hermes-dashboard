"use client";

import { useActionState } from "react";

import { PV_INITIAL_STATE, validatePvStudyAction, verifyPvEconomicsAction } from "@/app/actions/pv";
import { isHumanCertified, pvBadge, pvToneClass } from "@/lib/pv/status";
import type { PvEconomics, PvStudy, PvStudyAssumptions } from "@/types/pv";

export type PvStudyBundle = {
  study: PvStudy;
  assumptions: PvStudyAssumptions | null;
  economics: PvEconomics[];
};

/**
 * PV-2 — études photovoltaïques et chiffrage économique.
 *
 * DEUX RÈGLES D'AFFICHAGE, non négociables :
 *   1. une étude non validée porte « À valider » et n'est JAMAIS présentée comme
 *      définitive — le bandeau le dit en toutes lettres, pas seulement par une
 *      couleur (une couleur seule exclurait un lecteur daltonien) ;
 *   2. un chiffrage `CALCULATED` ou `NEEDS_REVIEW` est visuellement DISTINCT
 *      d'un chiffrage `VERIFIED`, et le montant reste accompagné de sa réserve.
 *
 * Les HYPOTHÈSES sont affichées à côté des chiffres, pas cachées : un temps de
 * retour n'a aucun sens sans le prix de l'énergie et l'inflation qui l'ont
 * produit. C'est la raison d'être des colonnes typées de `pv_study_assumptions`.
 */
export default function PvStudyPanel({
  siteId,
  bundles,
}: {
  siteId: string;
  bundles: PvStudyBundle[];
}) {
  const [studyState, studyAction] = useActionState(validatePvStudyAction, PV_INITIAL_STATE);
  const [econState, econAction] = useActionState(verifyPvEconomicsAction, PV_INITIAL_STATE);

  if (bundles.length === 0) {
    return (
      <section className="dashboard-card pv-card">
        <div className="dashboard-card-header">
          <div>
            <span className="panel-eyebrow">PHOTOVOLTAÏQUE</span>
            <h3>Études</h3>
          </div>
        </div>
        <p className="photo-empty">
          Aucune étude pour ce site. L’Agent 5 — Bureau d’Études PV n’est pas activé : la
          capacité <code>pv.study.prepare</code> existe mais reste désactivée, et aucune étude
          n’est fabriquée automatiquement.
        </p>
      </section>
    );
  }

  return (
    <>
      {bundles.map(({ study, assumptions, economics }) => {
        const badge = pvBadge(study.status);
        const certified = isHumanCertified(study.status);
        return (
          <section key={study.id} className="dashboard-card pv-card">
            <div className="dashboard-card-header">
              <div>
                <span className="panel-eyebrow">PHOTOVOLTAÏQUE</span>
                <h3>Étude v{study.version}</h3>
              </div>
              <span className={pvToneClass(badge.tone)}>{badge.label}</span>
            </div>

            {certified ? null : (
              <p className="pv-warning" role="note">
                Cette étude n’est <strong>pas validée</strong>. Les valeurs ci-dessous sont un
                travail en cours — elles ne constituent ni un engagement, ni une promesse de
                rendement, ni une promesse d’économie.
              </p>
            )}

            <dl className="pv-facts">
              <div>
                <dt>Puissance cible</dt>
                <dd>{study.targetPowerKwc !== null ? `${study.targetPowerKwc} kWc` : "—"}</dd>
              </div>
              <div>
                <dt>Panneaux</dt>
                <dd>
                  {study.panelCount !== null ? `${study.panelCount} × ` : ""}
                  {study.panelUnitPowerW !== null ? `${study.panelUnitPowerW} W` : "—"}
                  {study.panelBrand ? ` · ${study.panelBrand}` : ""}
                </dd>
              </div>
              <div>
                <dt>Onduleur</dt>
                <dd>
                  {study.inverterType ?? "—"}
                  {study.inverterBrand ? ` · ${study.inverterBrand}` : ""}
                </dd>
              </div>
              <div>
                <dt>Batterie</dt>
                <dd>
                  {study.hasBattery
                    ? `Oui${study.batteryCapacityKwh !== null ? ` · ${study.batteryCapacityKwh} kWh` : ""}`
                    : "Non"}
                </dd>
              </div>
              <div>
                <dt>Production annuelle</dt>
                <dd>
                  {study.annualProductionKwh !== null ? `${study.annualProductionKwh} kWh` : "—"}
                </dd>
              </div>
              <div>
                <dt>Productible</dt>
                <dd>
                  {study.specificYieldKwhKwc !== null
                    ? `${study.specificYieldKwhKwc} kWh/kWc`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>Autoconsommation</dt>
                <dd>
                  {study.selfConsumptionRatePct !== null
                    ? `${study.selfConsumptionRatePct} %`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>Surplus</dt>
                <dd>{study.surplusKwh !== null ? `${study.surplusKwh} kWh` : "—"}</dd>
              </div>
              <div>
                <dt>Origine du calcul</dt>
                <dd>
                  {study.source} · préparée par {study.preparedBy}
                </dd>
              </div>
            </dl>

            <div className="pv-assumptions">
              <p className="panel-eyebrow">Hypothèses</p>
              {assumptions === null ? (
                <p className="photo-note">
                  Aucune hypothèse enregistrée. Un temps de retour sans hypothèse affichée
                  n’est pas exploitable.
                </p>
              ) : (
                <dl className="pv-facts">
                  <div>
                    <dt>Prix de l’énergie</dt>
                    <dd>
                      {assumptions.energyPriceEurKwh !== null
                        ? `${assumptions.energyPriceEurKwh} €/kWh`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Inflation retenue</dt>
                    <dd>
                      {assumptions.energyPriceInflationPct !== null
                        ? `${assumptions.energyPriceInflationPct} %/an`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Horizon</dt>
                    <dd>
                      {assumptions.analysisHorizonYears !== null
                        ? `${assumptions.analysisHorizonYears} ans`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Dégradation panneaux</dt>
                    <dd>
                      {assumptions.panelDegradationPctYear !== null
                        ? `${assumptions.panelDegradationPctYear} %/an`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Rachat du surplus</dt>
                    <dd>
                      {assumptions.surplusSalePriceEurKwh !== null
                        ? `${assumptions.surplusSalePriceEurKwh} €/kWh`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Aides</dt>
                    <dd>
                      {assumptions.subsidyTotalEur !== null
                        ? `${assumptions.subsidyTotalEur} €`
                        : "—"}
                      {assumptions.subsidyScheme ? ` · ${assumptions.subsidyScheme}` : ""}
                    </dd>
                  </div>
                </dl>
              )}
            </div>

            {certified ? null : (
              <form action={studyAction} className="pv-inline-form">
                <input type="hidden" name="study_id" value={study.id} />
                <input type="hidden" name="site_id" value={siteId} />
                <button type="submit" name="decision" value="validate" className="card-secondary-button">
                  Valider l’étude (geste humain)
                </button>
                <button type="submit" name="decision" value="reject" className="card-secondary-button">
                  Rejeter
                </button>
              </form>
            )}

            <div className="pv-economics">
              <p className="panel-eyebrow">Économie</p>
              {economics.length === 0 ? (
                <p className="photo-note">Aucun chiffrage économique pour cette étude.</p>
              ) : (
                economics.map((e) => {
                  const eBadge = pvBadge(e.status);
                  const eCertified = isHumanCertified(e.status);
                  return (
                    <div key={e.id} className="pv-economics-block">
                      <div className="pv-bill-head">
                        <strong>Chiffrage · calculé par {e.computedBy}</strong>
                        <span className={pvToneClass(eBadge.tone)}>{eBadge.label}</span>
                      </div>
                      {eCertified ? null : (
                        <p className="pv-warning" role="note">
                          Chiffrage <strong>non vérifié</strong> — à ne pas transmettre au client
                          en l’état.
                        </p>
                      )}
                      <dl className="pv-facts">
                        <div>
                          <dt>Investissement TTC</dt>
                          <dd>{e.investmentTtcEur !== null ? `${e.investmentTtcEur} €` : "—"}</dd>
                        </div>
                        <div>
                          <dt>Aides</dt>
                          <dd>{e.subsidyTotalEur !== null ? `${e.subsidyTotalEur} €` : "—"}</dd>
                        </div>
                        <div>
                          <dt>Reste à charge</dt>
                          <dd>{e.netCostEur !== null ? `${e.netCostEur} €` : "—"}</dd>
                        </div>
                        <div>
                          <dt>Économies année 1</dt>
                          <dd>{e.year1SavingsEur !== null ? `${e.year1SavingsEur} €` : "—"}</dd>
                        </div>
                        <div>
                          <dt>Revenus de surplus</dt>
                          <dd>
                            {e.surplusRevenueEur !== null ? `${e.surplusRevenueEur} €` : "—"}
                          </dd>
                        </div>
                        <div>
                          <dt>Temps de retour</dt>
                          <dd>{e.paybackYears !== null ? `${e.paybackYears} ans` : "—"}</dd>
                        </div>
                        <div>
                          <dt>VAN</dt>
                          <dd>{e.npvEur !== null ? `${e.npvEur} €` : "—"}</dd>
                        </div>
                        <div>
                          <dt>TRI</dt>
                          <dd>{e.irrPct !== null ? `${e.irrPct} %` : "—"}</dd>
                        </div>
                      </dl>
                      {eCertified ? null : (
                        <form action={econAction} className="pv-inline-form">
                          <input type="hidden" name="economics_id" value={e.id} />
                          <input type="hidden" name="site_id" value={siteId} />
                          <button
                            type="submit"
                            name="decision"
                            value="verify"
                            className="card-secondary-button"
                          >
                            Vérifier le chiffrage (geste humain)
                          </button>
                          <button
                            type="submit"
                            name="decision"
                            value="reject"
                            className="card-secondary-button"
                          >
                            Rejeter
                          </button>
                        </form>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </section>
        );
      })}

      {studyState.phase === "error" ? (
        <p className="photo-session-meta" role="alert">
          {studyState.message}
        </p>
      ) : null}
      {econState.phase === "error" ? (
        <p className="photo-session-meta" role="alert">
          {econState.message}
        </p>
      ) : null}
    </>
  );
}
