"use client";

import { useActionState } from "react";

import { createPvSiteAction, PV_INITIAL_STATE } from "@/app/actions/pv";

/**
 * PV-2 — ajout d'un site d'implantation.
 *
 * ORIENTATION ET INCLINAISON SONT NUMÉRIQUES, délibérément : PV-1 refuse une
 * chaîne libre parce que « plein sud » n'est calculable par aucun moteur de
 * production. L'écran affiche le repère (0 = Nord, 180 = Sud) plutôt que de
 * proposer une liste de mots qu'il faudrait ensuite deviner.
 */
export default function PvNewSiteForm({ prospectId }: { prospectId: string }) {
  const [state, formAction, pending] = useActionState(createPvSiteAction, PV_INITIAL_STATE);

  return (
    <section className="dashboard-card pv-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">PHOTOVOLTAÏQUE</span>
          <h3>Ajouter un site</h3>
        </div>
      </div>

      <form action={formAction} className="agent-action-form">
        <input type="hidden" name="prospect_id" value={prospectId} />

        <label className="agent-field">
          <span>Libellé</span>
          <input type="text" name="label" maxLength={120} placeholder="Maison principale, hangar nord…" />
        </label>
        <label className="agent-field">
          <span>Adresse</span>
          <input type="text" name="address_line1" required maxLength={200} />
        </label>
        <div className="agent-field-row">
          <label className="agent-field">
            <span>Code postal</span>
            <input type="text" name="postal_code" required maxLength={12} />
          </label>
          <label className="agent-field">
            <span>Ville</span>
            <input type="text" name="city" required maxLength={120} />
          </label>
        </div>

        <div className="agent-field-row">
          <label className="agent-field">
            <span>Type de bâtiment</span>
            <select name="building_type" defaultValue="">
              <option value="">Non renseigné</option>
              <option value="MAISON">Maison</option>
              <option value="IMMEUBLE">Immeuble</option>
              <option value="HANGAR">Hangar</option>
              <option value="ENTREPOT">Entrepôt</option>
              <option value="ATELIER">Atelier</option>
              <option value="BUREAU">Bureau</option>
              <option value="COMMERCE">Commerce</option>
              <option value="EXPLOITATION_AGRICOLE">Exploitation agricole</option>
              <option value="SERRE">Serre</option>
              <option value="OMBRIERE">Ombrière</option>
              <option value="SOL">Sol</option>
              <option value="AUTRE">Autre</option>
            </select>
          </label>
          <label className="agent-field">
            <span>Type de toiture</span>
            <select name="roof_type" defaultValue="">
              <option value="">Non renseigné</option>
              <option value="PENTE">Pente</option>
              <option value="TERRASSE">Terrasse</option>
              <option value="MULTIPENTE">Multipente</option>
              <option value="SHED">Shed</option>
              <option value="COURBE">Courbe</option>
              <option value="SOL">Sol</option>
              <option value="OMBRIERE">Ombrière</option>
              <option value="AUTRE">Autre</option>
            </select>
          </label>
        </div>

        <div className="agent-field-row">
          <label className="agent-field">
            <span>Couverture</span>
            <select name="roof_material" defaultValue="">
              <option value="">Non renseignée</option>
              <option value="TUILE">Tuile</option>
              <option value="ARDOISE">Ardoise</option>
              <option value="BAC_ACIER">Bac acier</option>
              <option value="FIBROCIMENT">Fibrociment</option>
              <option value="BITUME">Bitume</option>
              <option value="ZINC">Zinc</option>
              <option value="AUTRE">Autre</option>
            </select>
          </label>
          <label className="agent-field">
            <span>État de la toiture</span>
            <select name="roof_condition" defaultValue="">
              <option value="">Non renseigné</option>
              <option value="BON">Bon</option>
              <option value="MOYEN">Moyen</option>
              <option value="MAUVAIS">Mauvais</option>
              <option value="INCONNU">Inconnu</option>
            </select>
          </label>
        </div>

        <div className="agent-field-row">
          <label className="agent-field">
            <span>Surface totale (m²)</span>
            <input type="number" name="roof_area_total_m2" min={0} step="0.01" />
          </label>
          <label className="agent-field">
            <span>Surface exploitable (m²)</span>
            <input type="number" name="roof_area_usable_m2" min={0} step="0.01" />
          </label>
        </div>

        <div className="agent-field-row">
          <label className="agent-field">
            <span>Azimut (0 = Nord, 180 = Sud)</span>
            <input type="number" name="azimuth_deg" min={0} max={359.99} step="0.01" />
          </label>
          <label className="agent-field">
            <span>Inclinaison (0 à 90°)</span>
            <input type="number" name="tilt_deg" min={0} max={90} step="0.01" />
          </label>
        </div>

        <div className="agent-field-row">
          <label className="agent-field">
            <span>Ombrage</span>
            <select name="shading_level" defaultValue="">
              <option value="">Non renseigné</option>
              <option value="AUCUN">Aucun</option>
              <option value="FAIBLE">Faible</option>
              <option value="MODERE">Modéré</option>
              <option value="FORT">Fort</option>
            </select>
          </label>
          <label className="agent-field">
            <span>Hauteur (m)</span>
            <input type="number" name="height_m" min={0} step="0.01" />
          </label>
        </div>

        <label className="agent-field">
          <span>Accessibilité</span>
          <select name="access_difficulty" defaultValue="">
            <option value="">Non renseignée</option>
            <option value="FACILE">Facile</option>
            <option value="MOYEN">Moyenne</option>
            <option value="DIFFICILE">Difficile</option>
            <option value="TRES_DIFFICILE">Très difficile</option>
          </select>
        </label>

        <label className="agent-field">
          <span>Remarques techniques</span>
          <textarea name="technical_notes" rows={2} maxLength={2000} />
        </label>

        <button type="submit" className="card-secondary-button" disabled={pending}>
          {pending ? "Enregistrement…" : "Ajouter le site"}
        </button>
      </form>

      {state.phase === "error" ? (
        <p className="photo-session-meta" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.phase === "ok" ? (
        <p className="photo-session-meta" role="status">
          Site enregistré.
        </p>
      ) : null}
    </section>
  );
}
