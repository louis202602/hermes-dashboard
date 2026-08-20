"use client";

import { useActionState } from "react";

import {
  createPvEconomicsAction,
  createPvStudyAction,
  PV_INITIAL_STATE,
  savePvAssumptionsAction,
  setPvEconomicsStatusAction,
  setPvStudyStatusAction,
  updatePvEconomicsAction,
  updatePvStudyAction,
} from "@/app/actions/pv";
import type { PvEconomics, PvStudy, PvStudyAssumptions } from "@/types/pv";

/**
 * PV-3 — travail MANUEL sur une étude et son chiffrage.
 *
 * L'objectif du lot : mener une affaire de bout en bout SANS aucun agent IA.
 * Trois principes tenus par ces formulaires :
 *
 *   1. Une étude créée à la main naît en `DRAFT`. Le statut n'est PAS un champ
 *      de saisie : il a ses propres boutons, adossés à la machine à états.
 *   2. `VALIDATED` (étude) et `VERIFIED` (chiffrage) ne sont JAMAIS proposés
 *      ici — la validation humaine passe par le bouton dédié, qui seul inscrit
 *      l'acteur. La façade refuse d'ailleurs ces deux valeurs.
 *   3. Aucun chiffre n'est déduit. Le reste à charge ou le temps de retour sont
 *      saisis, pas calculés en douce : un chiffre montré au client doit avoir
 *      été posé par quelqu'un.
 */

const STUDY_NEXT: Record<string, string[]> = {
  DRAFT: ["CALCULATED", "NEEDS_REVIEW", "REJECTED"],
  CALCULATED: ["NEEDS_REVIEW", "DRAFT", "REJECTED"],
  NEEDS_REVIEW: ["CALCULATED", "DRAFT", "REJECTED"],
  REJECTED: ["DRAFT", "CALCULATED"],
  VALIDATED: [],
  SUPERSEDED: [],
};

const ECON_NEXT: Record<string, string[]> = {
  DRAFT: ["CALCULATED", "NEEDS_REVIEW", "REJECTED"],
  CALCULATED: ["NEEDS_REVIEW", "DRAFT", "REJECTED"],
  NEEDS_REVIEW: ["CALCULATED", "DRAFT", "REJECTED"],
  REJECTED: ["DRAFT", "CALCULATED"],
  VERIFIED: [],
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Brouillon",
  CALCULATED: "Calculée",
  NEEDS_REVIEW: "À valider",
  REJECTED: "Rejetée",
  SUPERSEDED: "Remplacée",
};

export function PvNewStudyForm({ siteId }: { siteId: string }) {
  const [state, formAction, pending] = useActionState(createPvStudyAction, PV_INITIAL_STATE);

  return (
    <section className="dashboard-card pv-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">PHOTOVOLTAÏQUE</span>
          <h3>Créer une étude (saisie manuelle)</h3>
        </div>
      </div>

      <form action={formAction} className="agent-action-form">
        <input type="hidden" name="site_id" value={siteId} />

        <div className="agent-field-row">
          <label className="agent-field">
            <span>Puissance cible (kWc)</span>
            <input type="number" name="target_power_kwc" min={0} step="0.001" />
          </label>
          <label className="agent-field">
            <span>Nombre de panneaux</span>
            <input type="number" name="panel_count" min={1} step="1" />
          </label>
        </div>
        <div className="agent-field-row">
          <label className="agent-field">
            <span>Puissance unitaire (W)</span>
            <input type="number" name="panel_unit_power_w" min={0} step="0.1" />
          </label>
          <label className="agent-field">
            <span>Marque panneau</span>
            <input type="text" name="panel_brand" maxLength={120} />
          </label>
        </div>
        <label className="agent-field">
          <span>Référence panneau</span>
          <input type="text" name="panel_reference" maxLength={160} />
        </label>

        <div className="agent-field-row">
          <label className="agent-field">
            <span>Type d’onduleur</span>
            <select name="inverter_type" defaultValue="">
              <option value="">Non renseigné</option>
              <option value="STRING">String</option>
              <option value="MICRO">Micro-onduleurs</option>
              <option value="HYBRIDE">Hybride</option>
              <option value="CENTRAL">Central</option>
              <option value="AUTRE">Autre</option>
            </select>
          </label>
          <label className="agent-field">
            <span>Marque onduleur</span>
            <input type="text" name="inverter_brand" maxLength={120} />
          </label>
        </div>
        <div className="agent-field-row">
          <label className="agent-field">
            <span>Référence onduleur</span>
            <input type="text" name="inverter_reference" maxLength={160} />
          </label>
          <label className="agent-field">
            <span>Nombre de micro-onduleurs</span>
            <input type="number" name="microinverter_count" min={0} step="1" />
          </label>
        </div>

        <label className="agent-field pv-checkbox">
          <input type="checkbox" name="has_battery" />
          <span>Batterie prévue</span>
        </label>
        <div className="agent-field-row">
          <label className="agent-field">
            <span>Capacité batterie (kWh)</span>
            <input type="number" name="battery_capacity_kwh" min={0} step="0.001" />
          </label>
          <label className="agent-field">
            <span>Puissance batterie (kW)</span>
            <input type="number" name="battery_power_kw" min={0} step="0.001" />
          </label>
        </div>
        <p className="photo-note">
          Sans batterie cochée, capacité et puissance sont ignorées — la base refuse une
          étude qui annoncerait une batterie absente.
        </p>

        <div className="agent-field-row">
          <label className="agent-field">
            <span>Production annuelle (kWh)</span>
            <input type="number" name="annual_production_kwh" min={0} step="0.01" />
          </label>
          <label className="agent-field">
            <span>Productible (kWh/kWc)</span>
            <input type="number" name="specific_yield_kwh_kwc" min={0} step="0.01" />
          </label>
        </div>
        <div className="agent-field-row">
          <label className="agent-field">
            <span>Autoconsommation (%)</span>
            <input type="number" name="self_consumption_rate_pct" min={0} max={100} step="0.01" />
          </label>
          <label className="agent-field">
            <span>Autoproduction (%)</span>
            <input type="number" name="self_production_rate_pct" min={0} max={100} step="0.01" />
          </label>
        </div>
        <div className="agent-field-row">
          <label className="agent-field">
            <span>Surplus estimé (kWh)</span>
            <input type="number" name="surplus_kwh" min={0} step="0.01" />
          </label>
          <label className="agent-field">
            <span>Pertes système (%)</span>
            <input type="number" name="system_losses_pct" min={0} max={100} step="0.01" />
          </label>
        </div>

        <div className="agent-field-row">
          <label className="agent-field">
            <span>Source</span>
            <select name="source" defaultValue="MANUAL">
              <option value="MANUAL">Saisie manuelle</option>
              <option value="OTHER">Autre outil</option>
            </select>
          </label>
          <label className="agent-field">
            <span>Méthode de calcul</span>
            <input type="text" name="calculation_method" maxLength={200} />
          </label>
        </div>
        <p className="photo-note">
          PVGIS et OpenSolar ne sont pas branchés : ils ne sont donc pas proposés ici.
        </p>

        <label className="agent-field">
          <span>Notes</span>
          <textarea name="notes" rows={2} maxLength={2000} />
        </label>

        <button type="submit" className="card-secondary-button" disabled={pending}>
          {pending ? "Création…" : "Créer l’étude (brouillon)"}
        </button>
      </form>

      {state.phase === "error" ? (
        <p className="photo-session-meta" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.phase === "ok" ? (
        <p className="photo-session-meta" role="status">
          Étude créée en brouillon.
        </p>
      ) : null}
    </section>
  );
}

export function PvStudyEditor({
  siteId,
  study,
  assumptions,
  economics,
}: {
  siteId: string;
  study: PvStudy;
  assumptions: PvStudyAssumptions | null;
  economics: PvEconomics[];
}) {
  const [editState, editAction, editing] = useActionState(updatePvStudyAction, PV_INITIAL_STATE);
  const [assumptionState, assumptionAction] = useActionState(
    savePvAssumptionsAction,
    PV_INITIAL_STATE,
  );
  const [statusState, statusAction] = useActionState(setPvStudyStatusAction, PV_INITIAL_STATE);
  const [econCreateState, econCreateAction] = useActionState(
    createPvEconomicsAction,
    PV_INITIAL_STATE,
  );
  const [econEditState, econEditAction] = useActionState(
    updatePvEconomicsAction,
    PV_INITIAL_STATE,
  );
  const [econStatusState, econStatusAction] = useActionState(
    setPvEconomicsStatusAction,
    PV_INITIAL_STATE,
  );

  const nextStatuses = STUDY_NEXT[study.status] ?? [];
  const locked = study.status === "VALIDATED" || study.status === "SUPERSEDED";

  return (
    <section className="dashboard-card pv-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">PHOTOVOLTAÏQUE</span>
          <h3>Modifier l’étude v{study.version}</h3>
        </div>
        <span className="photo-badge">{STATUS_LABELS[study.status] ?? study.status}</span>
      </div>

      {locked ? (
        <p className="photo-note">
          Cette étude est {study.status === "VALIDATED" ? "validée" : "remplacée"} : elle
          n’est plus modifiable ici. Créez une nouvelle version pour repartir d’elle.
        </p>
      ) : (
        <>
          <form action={editAction} className="agent-action-form">
            <input type="hidden" name="study_id" value={study.id} />
            <input type="hidden" name="site_id" value={siteId} />
            <div className="agent-field-row">
              <label className="agent-field">
                <span>Puissance cible (kWc)</span>
                <input type="number" name="target_power_kwc" min={0} step="0.001" defaultValue={study.targetPowerKwc ?? ""} />
              </label>
              <label className="agent-field">
                <span>Nombre de panneaux</span>
                <input type="number" name="panel_count" min={1} step="1" defaultValue={study.panelCount ?? ""} />
              </label>
            </div>
            <div className="agent-field-row">
              <label className="agent-field">
                <span>Production annuelle (kWh)</span>
                <input type="number" name="annual_production_kwh" min={0} step="0.01" defaultValue={study.annualProductionKwh ?? ""} />
              </label>
              <label className="agent-field">
                <span>Productible (kWh/kWc)</span>
                <input type="number" name="specific_yield_kwh_kwc" min={0} step="0.01" defaultValue={study.specificYieldKwhKwc ?? ""} />
              </label>
            </div>
            <div className="agent-field-row">
              <label className="agent-field">
                <span>Autoconsommation (%)</span>
                <input type="number" name="self_consumption_rate_pct" min={0} max={100} step="0.01" defaultValue={study.selfConsumptionRatePct ?? ""} />
              </label>
              <label className="agent-field">
                <span>Surplus (kWh)</span>
                <input type="number" name="surplus_kwh" min={0} step="0.01" defaultValue={study.surplusKwh ?? ""} />
              </label>
            </div>
            <label className="agent-field pv-checkbox">
              <input type="checkbox" name="has_battery" defaultChecked={study.hasBattery} />
              <span>Batterie prévue</span>
            </label>
            <label className="agent-field">
              <span>Capacité batterie (kWh)</span>
              <input type="number" name="battery_capacity_kwh" min={0} step="0.001" defaultValue={study.batteryCapacityKwh ?? ""} />
            </label>
            <button type="submit" className="card-secondary-button" disabled={editing}>
              {editing ? "Enregistrement…" : "Enregistrer l’étude"}
            </button>
          </form>
          {editState.phase === "error" ? (
            <p className="photo-session-meta" role="alert">{editState.message}</p>
          ) : null}

          <form action={statusAction} className="pv-inline-form">
            <input type="hidden" name="study_id" value={study.id} />
            <input type="hidden" name="site_id" value={siteId} />
            <label className="agent-field">
              <span>Faire avancer l’étude</span>
              <select name="status" defaultValue={nextStatuses[0] ?? ""}>
                {nextStatuses.length === 0 ? (
                  <option value="">Aucune transition possible</option>
                ) : (
                  nextStatuses.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s] ?? s}
                    </option>
                  ))
                )}
              </select>
            </label>
            <button
              type="submit"
              className="card-secondary-button"
              disabled={nextStatuses.length === 0}
            >
              Changer le statut
            </button>
          </form>
          <p className="photo-note">
            « Validée » n’apparaît pas ici : la validation humaine a son propre bouton, qui
            seul inscrit l’utilisateur validant. La base refuse tout autre chemin.
          </p>
          {statusState.phase === "error" ? (
            <p className="photo-session-meta" role="alert">{statusState.message}</p>
          ) : null}
        </>
      )}

      <form action={assumptionAction} className="agent-action-form">
        <input type="hidden" name="study_id" value={study.id} />
        <input type="hidden" name="site_id" value={siteId} />
        <p className="panel-eyebrow">Hypothèses</p>
        <div className="agent-field-row">
          <label className="agent-field">
            <span>Prix énergie (€/kWh)</span>
            <input type="number" name="energy_price_eur_kwh" min={0} step="0.00001" defaultValue={assumptions?.energyPriceEurKwh ?? ""} />
          </label>
          <label className="agent-field">
            <span>Inflation annuelle (%)</span>
            <input type="number" name="energy_price_inflation_pct" step="0.01" defaultValue={assumptions?.energyPriceInflationPct ?? ""} />
          </label>
        </div>
        <div className="agent-field-row">
          <label className="agent-field">
            <span>Horizon (années)</span>
            <input type="number" name="analysis_horizon_years" min={1} max={40} step="1" defaultValue={assumptions?.analysisHorizonYears ?? ""} />
          </label>
          <label className="agent-field">
            <span>Dégradation panneaux (%/an)</span>
            <input type="number" name="panel_degradation_pct_year" min={0} max={5} step="0.001" defaultValue={assumptions?.panelDegradationPctYear ?? ""} />
          </label>
        </div>
        <div className="agent-field-row">
          <label className="agent-field">
            <span>Rachat surplus (€/kWh)</span>
            <input type="number" name="surplus_sale_price_eur_kwh" min={0} step="0.00001" defaultValue={assumptions?.surplusSalePriceEurKwh ?? ""} />
          </label>
          <label className="agent-field">
            <span>Aides (€)</span>
            <input type="number" name="subsidy_total_eur" min={0} step="0.01" defaultValue={assumptions?.subsidyTotalEur ?? ""} />
          </label>
        </div>
        <label className="agent-field">
          <span>Dispositif d’aide</span>
          <input type="text" name="subsidy_scheme" maxLength={200} defaultValue={assumptions?.subsidyScheme ?? ""} />
        </label>
        <button type="submit" className="card-secondary-button">
          Enregistrer les hypothèses
        </button>
      </form>
      {assumptionState.phase === "error" ? (
        <p className="photo-session-meta" role="alert">{assumptionState.message}</p>
      ) : null}

      <div className="pv-economics">
        <p className="panel-eyebrow">Chiffrage économique</p>
        {economics.length === 0 ? (
          <form action={econCreateAction} className="agent-action-form">
            <input type="hidden" name="study_id" value={study.id} />
            <input type="hidden" name="site_id" value={siteId} />
            <p className="photo-note">
              Aucun chiffrage pour cette étude. Saisissez-le — aucun montant n’est déduit
              automatiquement.
            </p>
            <div className="agent-field-row">
              <label className="agent-field">
                <span>Investissement HT (€)</span>
                <input type="number" name="investment_ht_eur" min={0} step="0.01" />
              </label>
              <label className="agent-field">
                <span>Investissement TTC (€)</span>
                <input type="number" name="investment_ttc_eur" min={0} step="0.01" />
              </label>
            </div>
            <div className="agent-field-row">
              <label className="agent-field">
                <span>Aides / primes (€)</span>
                <input type="number" name="subsidy_total_eur" min={0} step="0.01" />
              </label>
              <label className="agent-field">
                <span>Reste à charge (€)</span>
                <input type="number" name="net_cost_eur" min={0} step="0.01" />
              </label>
            </div>
            <div className="agent-field-row">
              <label className="agent-field">
                <span>Économies année 1 (€)</span>
                <input type="number" name="year1_savings_eur" min={0} step="0.01" />
              </label>
              <label className="agent-field">
                <span>Revenus surplus (€)</span>
                <input type="number" name="surplus_revenue_eur" min={0} step="0.01" />
              </label>
            </div>
            <div className="agent-field-row">
              <label className="agent-field">
                <span>Gain annuel (€)</span>
                <input type="number" name="annual_gain_eur" min={0} step="0.01" />
              </label>
              <label className="agent-field">
                <span>Temps de retour (années)</span>
                <input type="number" name="payback_years" min={0} step="0.01" />
              </label>
            </div>
            <div className="agent-field-row">
              <label className="agent-field">
                <span>ROI simple (%)</span>
                <input type="number" name="simple_roi_pct" step="0.01" />
              </label>
              <label className="agent-field">
                <span>VAN (€)</span>
                <input type="number" name="npv_eur" step="0.01" />
              </label>
            </div>
            <label className="agent-field">
              <span>TRI (%)</span>
              <input type="number" name="irr_pct" step="0.01" />
            </label>
            <button type="submit" className="card-secondary-button">
              Créer le chiffrage (brouillon)
            </button>
          </form>
        ) : (
          economics.map((e) => {
            const econNext = ECON_NEXT[e.status] ?? [];
            const econLocked = e.status === "VERIFIED";
            return (
              <div key={e.id} className="pv-economics-block">
                <div className="pv-bill-head">
                  <strong>Chiffrage · {e.computedBy}</strong>
                  <span className="photo-badge">{STATUS_LABELS[e.status] ?? e.status}</span>
                </div>
                {econLocked ? (
                  <p className="photo-note">
                    Chiffrage vérifié : il n’est plus modifiable ici.
                  </p>
                ) : (
                  <>
                    <form action={econEditAction} className="agent-action-form">
                      <input type="hidden" name="economics_id" value={e.id} />
                      <input type="hidden" name="site_id" value={siteId} />
                      <div className="agent-field-row">
                        <label className="agent-field">
                          <span>Investissement TTC (€)</span>
                          <input type="number" name="investment_ttc_eur" min={0} step="0.01" defaultValue={e.investmentTtcEur ?? ""} />
                        </label>
                        <label className="agent-field">
                          <span>Aides (€)</span>
                          <input type="number" name="subsidy_total_eur" min={0} step="0.01" defaultValue={e.subsidyTotalEur ?? ""} />
                        </label>
                      </div>
                      <div className="agent-field-row">
                        <label className="agent-field">
                          <span>Reste à charge (€)</span>
                          <input type="number" name="net_cost_eur" min={0} step="0.01" defaultValue={e.netCostEur ?? ""} />
                        </label>
                        <label className="agent-field">
                          <span>Temps de retour (années)</span>
                          <input type="number" name="payback_years" min={0} step="0.01" defaultValue={e.paybackYears ?? ""} />
                        </label>
                      </div>
                      <button type="submit" className="card-secondary-button">
                        Enregistrer le chiffrage
                      </button>
                    </form>
                    <form action={econStatusAction} className="pv-inline-form">
                      <input type="hidden" name="economics_id" value={e.id} />
                      <input type="hidden" name="site_id" value={siteId} />
                      <label className="agent-field">
                        <span>Faire avancer le chiffrage</span>
                        <select name="status" defaultValue={econNext[0] ?? ""}>
                          {econNext.length === 0 ? (
                            <option value="">Aucune transition possible</option>
                          ) : (
                            econNext.map((s) => (
                              <option key={s} value={s}>
                                {STATUS_LABELS[s] ?? s}
                              </option>
                            ))
                          )}
                        </select>
                      </label>
                      <button
                        type="submit"
                        className="card-secondary-button"
                        disabled={econNext.length === 0}
                      >
                        Changer le statut
                      </button>
                    </form>
                  </>
                )}
              </div>
            );
          })
        )}
        {econCreateState.phase === "error" ? (
          <p className="photo-session-meta" role="alert">{econCreateState.message}</p>
        ) : null}
        {econEditState.phase === "error" ? (
          <p className="photo-session-meta" role="alert">{econEditState.message}</p>
        ) : null}
        {econStatusState.phase === "error" ? (
          <p className="photo-session-meta" role="alert">{econStatusState.message}</p>
        ) : null}
      </div>
    </section>
  );
}
