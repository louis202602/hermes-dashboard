import {
  Boxes,
  CircleSlash,
  Clock,
  Database,
  Cloud,
  Workflow,
} from "lucide-react";

import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import type { PlatformHealth, ServiceResult } from "@/types/hermes";

type SystemStatusProps = {
  health: ServiceResult<PlatformHealth>;
};

// Infra signals we do NOT measure from the dashboard. Shown honestly as
// "Non mesuré" — never as an invented SLA / latency number.
const UNMEASURED = [
  { name: "Disponibilité n8n", detail: "Uptime automatisations", icon: Workflow },
  { name: "Latence Supabase", detail: "Temps de réponse données", icon: Database },
  { name: "Uptime Vercel", detail: "Disponibilité applicative", icon: Cloud },
];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section className="dashboard-card system-status-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">INFRASTRUCTURE</span>
          <h3>État du système</h3>
        </div>
        <ProvenanceBadge provenance="REAL" />
      </div>
      {children}
    </section>
  );
}

export default function SystemStatus({ health }: SystemStatusProps) {
  const ok = health.ok && health.data.resolutionStatus === "OK";
  const data = health.ok ? health.data : null;

  return (
    <Frame>
      <div className="system-services-list">
        {/* REAL measured facts from the component registry + execution log. */}
        <div className="system-service-item">
          <span className="system-service-icon">
            <Boxes size={18} strokeWidth={1.8} />
          </span>
          <div className="system-service-copy">
            <strong>Composants enregistrés</strong>
            <span>Registre Hermès OS</span>
          </div>
          <div className="system-service-value">
            <strong>
              {ok && data
                ? `${data.componentsActive} / ${data.componentsRegistered}`
                : "—"}
            </strong>
            <span>{ok ? "actifs" : "Indisponible"}</span>
          </div>
        </div>

        <div className="system-service-item">
          <span className="system-service-icon">
            <Clock size={18} strokeWidth={1.8} />
          </span>
          <div className="system-service-copy">
            <strong>Dernière exécution</strong>
            <span>Journal d’exécution réel</span>
          </div>
          <div className="system-service-value">
            <strong>{ok && data ? formatDate(data.lastExecutionAt) : "—"}</strong>
            <span>{ok ? "enregistrée" : "Indisponible"}</span>
          </div>
        </div>

        {/* Honestly UNAVAILABLE — not measured, never faked. */}
        {UNMEASURED.map((service) => {
          const Icon = service.icon;
          return (
            <div className="system-service-item is-unavailable" key={service.name}>
              <span className="system-service-icon">
                <Icon size={18} strokeWidth={1.8} />
              </span>
              <div className="system-service-copy">
                <strong>{service.name}</strong>
                <span>{service.detail}</span>
              </div>
              <div className="system-service-value">
                <span className="system-service-unavailable">
                  <CircleSlash size={14} strokeWidth={1.9} />
                  Non mesuré
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="system-footer">
        <ProvenanceBadge provenance="UNAVAILABLE" />
        <span>
          Aucun SLA n’est affiché tant qu’il n’est pas réellement mesuré.
        </span>
      </div>
    </Frame>
  );
}
