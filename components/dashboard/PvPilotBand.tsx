import Link from "next/link";

import { pvProspectName } from "@/lib/pv/status";
import type { PvPilotSnapshot } from "@/types/pv";

/**
 * PV-3 — bandeau de pilotage : les trois widgets solaires.
 *
 * Ils sont déclarés au registre de widgets (`lib/dashboard/widgets.ts`) avec le
 * portillon `requiredModule: "solar.studies"`, et possédés par ce module
 * (`lib/verticals/modules.ts`). Menu, garde de route, galerie de réglages et ce
 * bandeau lisent donc la MÊME liste : ils ne peuvent pas diverger.
 *
 * COST-FIRST : les trois lisent UN instantané partagé (`get_pv_pilot_snapshot`).
 * Trois widgets ne font jamais trois lectures.
 *
 * À VIDE : les compteurs valent 0 et le disent. Aucun chiffre n'est illustratif.
 */
export default function PvPilotBand({ snapshot }: { snapshot: PvPilotSnapshot }) {
  const cards = [
    {
      id: "pv-studies-to-validate",
      label: "Études à valider",
      count: snapshot.studiesToValidate,
      empty: "Aucune étude en attente d’un geste humain.",
      detail: snapshot.studies.map((s) => ({
        key: s.id,
        href: `/etudes/sites/${s.siteId}`,
        main: `Étude v${s.version}${s.targetPowerKwc !== null ? ` · ${s.targetPowerKwc} kWc` : ""}`,
        meta: `${s.status} · préparée par ${s.preparedBy}`,
      })),
    },
    {
      id: "pv-bills-to-verify",
      label: "Factures énergie à vérifier",
      count: snapshot.billsToVerify,
      empty: "Aucune facture en attente de vérification.",
      detail: snapshot.bills.map((b) => ({
        key: b.id,
        href: `/etudes/sites/${b.siteId}`,
        main: b.supplier ?? "Fournisseur non renseigné",
        meta: `${b.status}${b.consumptionKwh !== null ? ` · ${b.consumptionKwh} kWh` : ""}`,
      })),
    },
    {
      id: "pv-prospects-without-site",
      label: "Prospects sans site",
      count: snapshot.prospectsWithoutSite,
      empty: "Chaque prospect actif a au moins un site.",
      detail: snapshot.prospects.map((p) => ({
        key: p.id,
        href: `/etudes/${p.id}`,
        main: pvProspectName(p),
        meta: p.status,
      })),
    },
  ];

  return (
    <section className="dashboard-card pv-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">PHOTOVOLTAÏQUE</span>
          <h3>Pilotage</h3>
        </div>
      </div>

      <div className="pv-pilot-grid">
        {cards.map((c) => (
          <article key={c.id} className="pv-pilot-card">
            <span className="panel-eyebrow">{c.label}</span>
            <strong className="pv-pilot-count">{c.count}</strong>
            {c.count === 0 ? (
              <p className="photo-note">{c.empty}</p>
            ) : (
              <ul className="pv-pilot-list">
                {c.detail.map((d) => (
                  <li key={d.key}>
                    <Link href={d.href} className="photo-session-main">
                      <strong>{d.main}</strong>
                      <span className="photo-session-meta">{d.meta}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
