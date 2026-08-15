import { FileText, HandCoins, Send } from "lucide-react";

import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import type { DashboardCommercial } from "@/lib/dashboard/systemActivity";
import type { ServiceResult } from "@/types/hermes";

type Props = {
  commercial: ServiceResult<DashboardCommercial>;
  locale: string;
};

function fmtEur(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${Math.round(amount)} ${currency}`;
  }
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section className="dashboard-card commercial-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">COMMERCIAL</span>
          <h3>Activité commerciale</h3>
        </div>
        <ProvenanceBadge provenance="REAL" />
      </div>
      {children}
    </section>
  );
}

export default function CommercialPanel({ commercial, locale }: Props) {
  if (!commercial.ok || commercial.data.resolutionStatus !== "OK") {
    return (
      <Frame>
        <p className="commercial-empty">
          L’activité commerciale est indisponible pour le moment.
        </p>
      </Frame>
    );
  }

  const c = commercial.data;

  return (
    <Frame>
      {c.total === 0 ? (
        <p className="commercial-empty">
          Aucun devis enregistré pour votre tenant.
        </p>
      ) : (
        <>
          <div className="commercial-grid">
            <div className="commercial-metric">
              <Send size={15} strokeWidth={1.8} />
              <strong>{c.sent}</strong>
              <span>envoyés</span>
            </div>
            <div
              className={`commercial-metric${c.toFollowUp > 0 ? " is-warning" : ""}`}
            >
              <FileText size={15} strokeWidth={1.8} />
              <strong>{c.toFollowUp}</strong>
              <span>à relancer</span>
            </div>
            <div className="commercial-metric is-success">
              <HandCoins size={15} strokeWidth={1.8} />
              <strong>{c.accepted}</strong>
              <span>acceptés</span>
            </div>
          </div>
          <div className="commercial-amounts">
            <div>
              <span>Montant envoyé (TTC)</span>
              <strong>{fmtEur(c.amountSentTtcEur, c.currency, locale)}</strong>
            </div>
            <div>
              <span>Montant accepté (TTC)</span>
              <strong>
                {fmtEur(c.amountAcceptedTtcEur, c.currency, locale)}
              </strong>
            </div>
          </div>
        </>
      )}
      <p className="commercial-note">
        Devis réels ({c.currency}). Factures / prospects / contrats : non
        disponibles.
      </p>
    </Frame>
  );
}
