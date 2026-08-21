import Link from "next/link";
import { notFound } from "next/navigation";

import PhotoSessionActions from "@/components/dashboard/PhotoSessionActions";
import { requireRoute } from "@/lib/dashboard/routeGuard";
import {
  PHOTO_BLOCKED_LABEL,
  PHOTO_NEXT_ACTION_LABEL,
  PHOTO_STATUS_LABEL,
  isNextActionAvailable,
  nextActionHref,
} from "@/lib/photo/sessionState";
import { INSTRUCTION_KIND_LABEL } from "@/lib/photo/instructions";
import { getPhotoSessionDetail } from "@/services/hermes/photo";

export const metadata = { title: "Séance — Hermès Studio" };

/**
 * /seances/[id] — la fiche séance : état Studio Director, jalons réels, consignes
 * de tri en vigueur, et LE prochain geste. Aucun chiffre n'est estimé : un jalon
 * non atteint s'affiche vide, pas « en cours ».
 */
export default async function PhotoSessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Même garde que le menu et que /chantiers/carte : une seule liste de modules.
  const ctx = await requireRoute("/seances");

  const { id } = await params;
  const detail = await getPhotoSessionDetail(id);
  if (!detail.ok || !detail.data.found || !detail.data.session) notFound();

  const { session, client, instructions, state } = detail.data;
  const href = state ? nextActionHref(id, state.nextAction) : null;
  const actionable = isNextActionAvailable(state) && href !== null;

  const milestones: { label: string; at: string | null }[] = [
    { label: "Séance réalisée", at: session.shotAt },
    { label: "Photos importées", at: session.importedAt },
    { label: "Tri effectué", at: session.culledAt },
    { label: "Sélection validée", at: session.selectionApprovedAt },
    { label: "Livrée", at: session.deliveredAt },
  ];

  return (
    <div className="page-stack">
      <section className="dashboard-card photo-card">
        <div className="dashboard-card-header">
          <div>
            <span className="panel-eyebrow">HERMÈS STUDIO</span>
            <h3>{session.title ?? client?.displayName ?? "Séance"}</h3>
          </div>
        </div>
        <p className="photo-session-meta">
          {client?.displayName} · {session.sessionType.toLowerCase()} ·{" "}
          {PHOTO_STATUS_LABEL[session.status] ?? session.status}
          {session.locationLabel ? ` · ${session.locationLabel}` : ""}
        </p>

        {state ? (
          <div className="photo-actions">
            {actionable ? (
              <Link href={href} className="card-secondary-button">
                {PHOTO_NEXT_ACTION_LABEL[state.nextAction]}
              </Link>
            ) : (
              <span className="photo-note">
                {state.blockedBy
                  ? (PHOTO_BLOCKED_LABEL[state.blockedBy] ?? state.blockedBy)
                  : PHOTO_NEXT_ACTION_LABEL[state.nextAction]}
              </span>
            )}
            <PhotoSessionActions sessionId={id} nextAction={state.nextAction} />
          </div>
        ) : null}
      </section>

      <section className="dashboard-card photo-card">
        <div className="dashboard-card-header">
          <div>
            <span className="panel-eyebrow">HERMÈS STUDIO</span>
            <h3>Jalons</h3>
          </div>
        </div>
        <ul className="photo-session-list">
          {milestones.map((m) => (
            <li key={m.label} className="photo-session-item">
              <span className="photo-session-main">
                <strong>{m.label}</strong>
              </span>
              <span className="photo-session-meta">
                {m.at ? new Date(m.at).toLocaleString(ctx.locale) : "—"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="dashboard-card photo-card">
        <div className="dashboard-card-header">
          <div>
            <span className="panel-eyebrow">HERMÈS STUDIO</span>
            <h3>Consignes de tri</h3>
          </div>
        </div>
        {instructions.length === 0 ? (
          <p className="photo-empty">Aucune consigne enregistrée.</p>
        ) : (
          <ul className="photo-session-list">
            {instructions.map((i) => (
              <li key={i.id} className="photo-session-item">
                <span className="photo-session-main">
                  <strong>{i.instruction}</strong>
                  <span className="photo-session-meta">
                    {INSTRUCTION_KIND_LABEL[i.kind]} · « {i.keyword} »
                    {i.isGlobal ? " · permanente" : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
