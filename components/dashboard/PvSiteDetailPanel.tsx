"use client";

import Link from "next/link";
import { useActionState } from "react";

import { PV_INITIAL_STATE, updatePvSiteAction } from "@/app/actions/pv";
import { pvAzimuthLabel } from "@/lib/pv/status";
import type { PvSiteDetail } from "@/types/pv";

/** Lit une clé de la projection de façade sans jamais inventer de valeur. */
function s(site: PvSiteDetail, key: string): string {
  const v = site[key];
  if (v === null || v === undefined || v === "") return "";
  return String(v);
}

function n(site: PvSiteDetail, key: string): number | null {
  const v = site[key];
  if (v === null || v === undefined) return null;
  const parsed = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * PV-2 — caractéristiques techniques d'un site.
 *
 * Aucun champ n'est deviné : un champ vide reste vide et s'affiche « — ». C'est
 * volontaire — sur une étude photovoltaïque, une surface ou un ombrage inventé
 * se propage jusqu'à un chiffre montré au client.
 */
export default function PvSiteDetailPanel({ site }: { site: PvSiteDetail }) {
  const [state, formAction, pending] = useActionState(updatePvSiteAction, PV_INITIAL_STATE);
  const prospectId = s(site, "prospect_id");
  const azimuth = n(site, "azimuth_deg");

  return (
    <section className="dashboard-card pv-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">PHOTOVOLTAÏQUE</span>
          <h3>{s(site, "label") || s(site, "address_line1") || "Site"}</h3>
        </div>
        {prospectId ? (
          <Link href={`/etudes/${prospectId}`} className="photo-badge">
            Revenir au prospect
          </Link>
        ) : null}
      </div>

      <dl className="pv-facts">
        <div>
          <dt>Adresse</dt>
          <dd>
            {[s(site, "address_line1"), s(site, "postal_code"), s(site, "city")]
              .filter(Boolean)
              .join(", ") || "—"}
          </dd>
        </div>
        <div>
          <dt>Bâtiment</dt>
          <dd>{s(site, "building_type") || "—"}</dd>
        </div>
        <div>
          <dt>Usage</dt>
          <dd>{s(site, "building_use") || "—"}</dd>
        </div>
        <div>
          <dt>Occupation</dt>
          <dd>{s(site, "occupancy") || "—"}</dd>
        </div>
        <div>
          <dt>Toiture</dt>
          <dd>{s(site, "roof_type") || "—"}</dd>
        </div>
        <div>
          <dt>Couverture</dt>
          <dd>{s(site, "roof_material") || "—"}</dd>
        </div>
        <div>
          <dt>État</dt>
          <dd>{s(site, "roof_condition") || "—"}</dd>
        </div>
        <div>
          <dt>Surface totale</dt>
          <dd>{n(site, "roof_area_total_m2") !== null ? `${s(site, "roof_area_total_m2")} m²` : "—"}</dd>
        </div>
        <div>
          <dt>Surface exploitable</dt>
          <dd>
            {n(site, "roof_area_usable_m2") !== null ? `${s(site, "roof_area_usable_m2")} m²` : "—"}
          </dd>
        </div>
        <div>
          <dt>Orientation</dt>
          <dd>{pvAzimuthLabel(azimuth) ?? "—"}</dd>
        </div>
        <div>
          <dt>Inclinaison</dt>
          <dd>{n(site, "tilt_deg") !== null ? `${s(site, "tilt_deg")}°` : "—"}</dd>
        </div>
        <div>
          <dt>Ombrage</dt>
          <dd>
            {s(site, "shading_level") || "—"}
            {n(site, "shading_loss_pct") !== null ? ` · ${s(site, "shading_loss_pct")} % de pertes` : ""}
          </dd>
        </div>
        <div>
          <dt>Hauteur</dt>
          <dd>{n(site, "height_m") !== null ? `${s(site, "height_m")} m` : "—"}</dd>
        </div>
        <div>
          <dt>Accessibilité</dt>
          <dd>{s(site, "access_difficulty") || "—"}</dd>
        </div>
      </dl>

      <form action={formAction} className="agent-action-form">
        <input type="hidden" name="site_id" value={s(site, "id")} />
        <p className="panel-eyebrow">Corriger les caractéristiques</p>
        <div className="agent-field-row">
          <label className="agent-field">
            <span>Surface exploitable (m²)</span>
            <input
              type="number"
              name="roof_area_usable_m2"
              min={0}
              step="0.01"
              defaultValue={s(site, "roof_area_usable_m2")}
            />
          </label>
          <label className="agent-field">
            <span>Azimut (0 = Nord, 180 = Sud)</span>
            <input
              type="number"
              name="azimuth_deg"
              min={0}
              max={359.99}
              step="0.01"
              defaultValue={s(site, "azimuth_deg")}
            />
          </label>
        </div>
        <div className="agent-field-row">
          <label className="agent-field">
            <span>Inclinaison (0 à 90°)</span>
            <input type="number" name="tilt_deg" min={0} max={90} step="0.01" defaultValue={s(site, "tilt_deg")} />
          </label>
          <label className="agent-field">
            <span>Pertes d’ombrage (%)</span>
            <input
              type="number"
              name="shading_loss_pct"
              min={0}
              max={100}
              step="0.01"
              defaultValue={s(site, "shading_loss_pct")}
            />
          </label>
        </div>
        <label className="agent-field">
          <span>Ombrage</span>
          <select name="shading_level" defaultValue={s(site, "shading_level")}>
            <option value="">Non renseigné</option>
            <option value="AUCUN">Aucun</option>
            <option value="FAIBLE">Faible</option>
            <option value="MODERE">Modéré</option>
            <option value="FORT">Fort</option>
          </select>
        </label>
        <label className="agent-field">
          <span>État de la toiture</span>
          <select name="roof_condition" defaultValue={s(site, "roof_condition")}>
            <option value="">Non renseigné</option>
            <option value="BON">Bon</option>
            <option value="MOYEN">Moyen</option>
            <option value="MAUVAIS">Mauvais</option>
            <option value="INCONNU">Inconnu</option>
          </select>
        </label>
        <label className="agent-field">
          <span>Remarques techniques</span>
          <textarea name="technical_notes" rows={2} defaultValue={s(site, "technical_notes")} maxLength={2000} />
        </label>
        <button type="submit" className="card-secondary-button" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </button>
      </form>

      {state.phase === "error" ? (
        <p className="photo-session-meta" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.phase === "ok" ? (
        <p className="photo-session-meta" role="status">
          Site mis à jour.
        </p>
      ) : null}
    </section>
  );
}
