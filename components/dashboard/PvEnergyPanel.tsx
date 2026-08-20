"use client";

import { useActionState } from "react";

import {
  PV_INITIAL_STATE,
  promotePvExtractionAction,
  registerPvBillAction,
  savePvConsumptionAction,
  verifyPvBillAction,
  verifyPvConsumptionAction,
} from "@/app/actions/pv";
import { pvBadge, pvToneClass } from "@/lib/pv/status";
import type { PvBillExtraction, PvConsumptionProfile, PvEnergyBill } from "@/types/pv";

/**
 * PV-2 — Énergie d'un site : consommation, factures, LECTURES IA.
 *
 * LE POINT CENTRAL DE CET ÉCRAN : « ce que l'IA a lu » et « ce qui est retenu »
 * ne partagent jamais une ligne, ni une couleur, ni un verbe. Les extractions
 * apparaissent dans un bloc SÉPARÉ, avec leur confiance, et le seul geste
 * proposé s'appelle « Reprendre ces valeurs » — jamais « valider » : la
 * promotion met la facture en À VALIDER, elle ne la certifie pas.
 *
 * La certification est un second geste, explicite, réservé à un humain — et la
 * base l'impose : un runner en `service_role` n'a pas d'`auth.uid()` et ne peut
 * donc pas produire `VERIFIED`.
 */
export default function PvEnergyPanel({
  siteId,
  profiles,
  bills,
  extractionsByBill,
}: {
  siteId: string;
  profiles: PvConsumptionProfile[];
  bills: PvEnergyBill[];
  extractionsByBill: Record<string, PvBillExtraction[]>;
}) {
  const [consumptionState, consumptionAction, consumptionPending] = useActionState(
    savePvConsumptionAction,
    PV_INITIAL_STATE,
  );
  const [billState, billAction, billPending] = useActionState(
    registerPvBillAction,
    PV_INITIAL_STATE,
  );
  const [verifyState, verifyAction] = useActionState(verifyPvBillAction, PV_INITIAL_STATE);
  const [consVerifyState, consVerifyAction] = useActionState(
    verifyPvConsumptionAction,
    PV_INITIAL_STATE,
  );
  const [promoteState, promoteAction] = useActionState(
    promotePvExtractionAction,
    PV_INITIAL_STATE,
  );

  const current = profiles[0] ?? null;

  return (
    <>
      <section className="dashboard-card pv-card">
        <div className="dashboard-card-header">
          <div>
            <span className="panel-eyebrow">PHOTOVOLTAÏQUE</span>
            <h3>Consommation</h3>
          </div>
          {current ? (
            <span className={pvToneClass(pvBadge(current.verificationStatus).tone)}>
              {pvBadge(current.verificationStatus).label}
            </span>
          ) : null}
        </div>

        {current === null ? (
          <p className="photo-empty">
            Aucun profil de consommation. Saisissez-le ci-dessous — aucune valeur n’est estimée
            à votre place.
          </p>
        ) : null}

        <form action={consumptionAction} className="agent-action-form">
          <input type="hidden" name="site_id" value={siteId} />
          {current ? <input type="hidden" name="profile_id" value={current.id} /> : null}

          <div className="agent-field-row">
            <label className="agent-field">
              <span>Fournisseur</span>
              <input type="text" name="energy_supplier" defaultValue={current?.energySupplier ?? ""} maxLength={120} />
            </label>
            <label className="agent-field">
              <span>Puissance souscrite (kVA)</span>
              <input type="number" name="subscribed_power_kva" min={0} step="0.01" defaultValue={current?.subscribedPowerKva ?? ""} />
            </label>
          </div>
          <div className="agent-field-row">
            <label className="agent-field">
              <span>Consommation annuelle (kWh)</span>
              <input type="number" name="annual_consumption_kwh" min={0} step="0.01" defaultValue={current?.annualConsumptionKwh ?? ""} />
            </label>
            <label className="agent-field">
              <span>Coût annuel (€)</span>
              <input type="number" name="annual_cost_eur" min={0} step="0.01" defaultValue={current?.annualCostEur ?? ""} />
            </label>
          </div>
          <div className="agent-field-row">
            <label className="agent-field">
              <span>Prix unitaire (€/kWh)</span>
              <input type="number" name="unit_price_eur_kwh" min={0} step="0.00001" defaultValue={current?.unitPriceEurKwh ?? ""} />
            </label>
            <label className="agent-field">
              <span>Option tarifaire</span>
              <select name="tariff_option" defaultValue={current?.tariffOption ?? ""}>
                <option value="">Non renseignée</option>
                <option value="BASE">Base</option>
                <option value="HPHC">Heures pleines / creuses</option>
                <option value="TEMPO">Tempo</option>
                <option value="EJP">EJP</option>
                <option value="POINTE_MOBILE">Pointe mobile</option>
                <option value="AUTRE">Autre</option>
              </select>
            </label>
          </div>
          <label className="agent-field">
            <span>PDL / PRM (14 chiffres)</span>
            <input type="text" name="delivery_point_ref" pattern="[0-9]{14}" defaultValue={current?.deliveryPointRef ?? ""} />
          </label>

          <button type="submit" className="card-secondary-button" disabled={consumptionPending}>
            {consumptionPending ? "Enregistrement…" : "Enregistrer la consommation"}
          </button>
        </form>
        {consumptionState.phase === "error" ? (
          <p className="photo-session-meta" role="alert">
            {consumptionState.message}
          </p>
        ) : null}

        {current && current.verificationStatus !== "VERIFIED" ? (
          <>
            <form action={consVerifyAction} className="pv-inline-form">
              <input type="hidden" name="profile_id" value={current.id} />
              <input type="hidden" name="site_id" value={siteId} />
              <button type="submit" name="decision" value="verify" className="card-secondary-button">
                Vérifier la consommation (geste humain)
              </button>
              <button type="submit" name="decision" value="reject" className="card-secondary-button">
                Rejeter
              </button>
            </form>
            <p className="photo-note">
              Une consommation vérifiée porte le nom de l’utilisateur qui l’a vérifiée. Un
              runner sans identité authentifiée ne peut pas produire cet état.
            </p>
          </>
        ) : null}
        {consVerifyState.phase === "error" ? (
          <p className="photo-session-meta" role="alert">
            {consVerifyState.message}
          </p>
        ) : null}
      </section>

      <section className="dashboard-card pv-card">
        <div className="dashboard-card-header">
          <div>
            <span className="panel-eyebrow">PHOTOVOLTAÏQUE</span>
            <h3>Factures d’énergie</h3>
          </div>
          <span className="photo-session-meta">
            {bills.length === 0 ? "aucune facture" : `${bills.length}`}
          </span>
        </div>

        {bills.length === 0 ? (
          <p className="photo-empty">
            Aucune facture enregistrée pour ce site.
          </p>
        ) : (
          <ul className="pv-bill-list">
            {bills.map((b) => {
              const badge = pvBadge(b.status);
              const extractions = extractionsByBill[b.id] ?? [];
              return (
                <li key={b.id} className="pv-bill">
                  <div className="pv-bill-head">
                    <div>
                      <strong>{b.supplier ?? "Fournisseur non renseigné"}</strong>
                      <span className="photo-session-meta">
                        {[b.periodStart, b.periodEnd].filter(Boolean).join(" → ") || "période non renseignée"}
                      </span>
                    </div>
                    <span className={pvToneClass(badge.tone)}>{badge.label}</span>
                  </div>

                  <dl className="pv-facts">
                    <div>
                      <dt>Montant TTC</dt>
                      <dd>{b.amountTtcEur !== null ? `${b.amountTtcEur} €` : "—"}</dd>
                    </div>
                    <div>
                      <dt>Consommation</dt>
                      <dd>{b.consumptionKwh !== null ? `${b.consumptionKwh} kWh` : "—"}</dd>
                    </div>
                    <div>
                      <dt>Puissance</dt>
                      <dd>{b.subscribedPowerKva !== null ? `${b.subscribedPowerKva} kVA` : "—"}</dd>
                    </div>
                    <div>
                      <dt>PDL / PRM</dt>
                      <dd>{b.deliveryPointRef ?? "—"}</dd>
                    </div>
                  </dl>

                  {b.status !== "VERIFIED" ? (
                    <form action={verifyAction} className="pv-inline-form">
                      <input type="hidden" name="bill_id" value={b.id} />
                      <input type="hidden" name="site_id" value={siteId} />
                      <button type="submit" name="decision" value="verify" className="card-secondary-button">
                        Vérifier (geste humain)
                      </button>
                      <button type="submit" name="decision" value="reject" className="card-secondary-button">
                        Rejeter
                      </button>
                    </form>
                  ) : (
                    <p className="photo-note">
                      Vérifiée le {b.verifiedAt ? b.verifiedAt.slice(0, 10) : "—"} — par un utilisateur
                      authentifié, imposé par la base.
                    </p>
                  )}

                  <div className="pv-extractions">
                    <p className="panel-eyebrow">
                      Lecture IA — {extractions.length === 0 ? "aucune" : `${extractions.length}`}
                    </p>
                    {extractions.length === 0 ? (
                      <p className="photo-note">
                        Aucune lecture automatique. L’Agent 4 n’est pas activé — la capacité
                        <code> pv.bill.extract </code> existe mais reste désactivée.
                      </p>
                    ) : (
                      <ul className="photo-session-list">
                        {extractions.map((e) => (
                          <li key={e.id} className="photo-session-item">
                            <span className="photo-session-main">
                              <strong>
                                {e.supplier ?? "—"} · {e.consumptionKwh ?? "—"} kWh ·{" "}
                                {e.amountTtcEur ?? "—"} €
                              </strong>
                              <span className="photo-session-meta">
                                {e.extractedBy} · confiance {(e.confidence * 100).toFixed(0)} %
                                {e.promotedToBill ? " · déjà reprise" : ""}
                              </span>
                            </span>
                            {e.promotedToBill ? null : (
                              <form action={promoteAction} className="pv-inline-form">
                                <input type="hidden" name="extraction_id" value={e.id} />
                                <input type="hidden" name="site_id" value={siteId} />
                                <button type="submit" className="card-secondary-button">
                                  Reprendre ces valeurs
                                </button>
                              </form>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="photo-note">
                      Reprendre des valeurs met la facture « À valider ». Ce n’est pas une
                      vérification : la certification reste un geste humain distinct.
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {verifyState.phase === "error" ? (
          <p className="photo-session-meta" role="alert">
            {verifyState.message}
          </p>
        ) : null}
        {promoteState.phase === "error" ? (
          <p className="photo-session-meta" role="alert">
            {promoteState.message}
          </p>
        ) : null}

        <form action={billAction} className="agent-action-form">
          <input type="hidden" name="site_id" value={siteId} />
          <p className="panel-eyebrow">Enregistrer une facture</p>
          <div className="agent-field-row">
            <label className="agent-field">
              <span>Fournisseur</span>
              <input type="text" name="supplier" maxLength={120} />
            </label>
            <label className="agent-field">
              <span>Émise le</span>
              <input type="date" name="issued_on" />
            </label>
          </div>
          <div className="agent-field-row">
            <label className="agent-field">
              <span>Début de période</span>
              <input type="date" name="period_start" />
            </label>
            <label className="agent-field">
              <span>Fin de période</span>
              <input type="date" name="period_end" />
            </label>
          </div>
          <div className="agent-field-row">
            <label className="agent-field">
              <span>Montant TTC (€)</span>
              <input type="number" name="amount_ttc_eur" min={0} step="0.01" />
            </label>
            <label className="agent-field">
              <span>Consommation (kWh)</span>
              <input type="number" name="consumption_kwh" min={0} step="0.01" />
            </label>
          </div>
          <button type="submit" className="card-secondary-button" disabled={billPending}>
            {billPending ? "Enregistrement…" : "Enregistrer la facture"}
          </button>
        </form>
        {billState.phase === "error" ? (
          <p className="photo-session-meta" role="alert">
            {billState.message}
          </p>
        ) : null}
      </section>
    </>
  );
}
