import Link from "next/link";

import { pvProspectName } from "@/lib/pv/status";
import type { PvPilotSnapshot } from "@/types/pv";

/**
 * PV-4 — les trois widgets solaires, rendus dans la GRILLE du dashboard.
 *
 * Ils lisent tous le MÊME instantané (`get_pv_pilot_snapshot`), chargé une fois
 * par la page : trois widgets ne font jamais trois lectures. C'est le contrat
 * `snapshotKeys` du registre, tenu et non seulement documenté.
 *
 * À vide, chacun dit 0 et l'explique. Aucun chiffre illustratif.
 */

function Card({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pv-widget">
      <div className="pv-widget-head">
        <span className="panel-eyebrow">{title}</span>
        <strong className="pv-pilot-count">{count}</strong>
      </div>
      {count === 0 ? <p className="photo-note">{empty}</p> : children}
    </div>
  );
}

export function PvStudiesToValidateWidget({ snapshot }: { snapshot: PvPilotSnapshot }) {
  return (
    <Card
      title="Études à valider"
      count={snapshot.studiesToValidate}
      empty="Aucune étude n’attend un geste humain."
    >
      <ul className="pv-pilot-list">
        {snapshot.studies.map((s) => (
          <li key={s.id}>
            <Link href={`/etudes/sites/${s.siteId}`} className="photo-session-main">
              <strong>
                Étude v{s.version}
                {s.targetPowerKwc !== null ? ` · ${s.targetPowerKwc} kWc` : ""}
              </strong>
              <span className="photo-session-meta">
                {s.status} · préparée par {s.preparedBy}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function PvBillsToVerifyWidget({ snapshot }: { snapshot: PvPilotSnapshot }) {
  return (
    <Card
      title="Factures énergie à vérifier"
      count={snapshot.billsToVerify}
      empty="Aucune facture en attente de vérification."
    >
      <ul className="pv-pilot-list">
        {snapshot.bills.map((b) => (
          <li key={b.id}>
            <Link href={`/etudes/sites/${b.siteId}`} className="photo-session-main">
              <strong>{b.supplier ?? "Fournisseur non renseigné"}</strong>
              <span className="photo-session-meta">
                {b.status}
                {b.consumptionKwh !== null ? ` · ${b.consumptionKwh} kWh` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function PvProspectsWithoutSiteWidget({ snapshot }: { snapshot: PvPilotSnapshot }) {
  return (
    <Card
      title="Prospects sans site"
      count={snapshot.prospectsWithoutSite}
      empty="Chaque prospect actif a au moins un site."
    >
      <ul className="pv-pilot-list">
        {snapshot.prospects.map((p) => (
          <li key={p.id}>
            <Link href={`/etudes/${p.id}`} className="photo-session-main">
              <strong>{pvProspectName(p)}</strong>
              <span className="photo-session-meta">{p.status}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
