"use client";

import { FileText, HandCoins, Send } from "lucide-react";

import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import type { DashboardCommercial } from "@/lib/dashboard/systemActivity";
import { useI18n } from "@/lib/i18n/I18nProvider";
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
  const { t } = useI18n();
  return (
    <section className="dashboard-card commercial-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">{t("comm.eyebrow")}</span>
          <h3>{t("comm.title")}</h3>
        </div>
        <ProvenanceBadge provenance="REAL" />
      </div>
      {children}
    </section>
  );
}

export default function CommercialPanel({ commercial, locale }: Props) {
  const { t } = useI18n();

  if (!commercial.ok || commercial.data.resolutionStatus !== "OK") {
    return (
      <Frame>
        <p className="commercial-empty">{t("comm.unavailable")}</p>
      </Frame>
    );
  }

  const c = commercial.data;

  return (
    <Frame>
      {c.total === 0 ? (
        <p className="commercial-empty">{t("comm.empty")}</p>
      ) : (
        <>
          <div className="commercial-grid">
            <div className="commercial-metric">
              <Send size={15} strokeWidth={1.8} />
              <strong>{c.sent}</strong>
              <span>{t("comm.sent")}</span>
            </div>
            <div
              className={`commercial-metric${c.toFollowUp > 0 ? " is-warning" : ""}`}
            >
              <FileText size={15} strokeWidth={1.8} />
              <strong>{c.toFollowUp}</strong>
              <span>{t("comm.toFollowUp")}</span>
            </div>
            <div className="commercial-metric is-success">
              <HandCoins size={15} strokeWidth={1.8} />
              <strong>{c.accepted}</strong>
              <span>{t("comm.accepted")}</span>
            </div>
          </div>
          <div className="commercial-amounts">
            <div>
              <span>{t("comm.amountSent")}</span>
              <strong>{fmtEur(c.amountSentTtcEur, c.currency, locale)}</strong>
            </div>
            <div>
              <span>{t("comm.amountAccepted")}</span>
              <strong>
                {fmtEur(c.amountAcceptedTtcEur, c.currency, locale)}
              </strong>
            </div>
          </div>
        </>
      )}
      <p className="commercial-note">
        {t("comm.note", { currency: c.currency })}
      </p>
    </Frame>
  );
}
