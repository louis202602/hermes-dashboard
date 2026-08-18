import "server-only";

import { logEvent } from "@/lib/observability/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ServiceResult, TenantResolutionStatus } from "@/types/hermes";
import type {
  PhotoClients,
  PhotoCullingReview,
  PhotoModuleState,
  PhotoReviewItem,
  PhotoSessionDetail,
  PhotoSessionState,
  PhotoSessions,
  PhotoToday,
  PhotoValueSnapshot,
  PhotoWriteOutcome,
} from "@/types/photo";

/**
 * PHOTO-P0 — Accès serveur à la verticale Hermès Studio.
 *
 * Chaque fonction n'est qu'un appel à une façade `SECURITY DEFINER` : tenant,
 * permissions, activation du module et bornage sont décidés EN BASE. Ce fichier
 * ne contient aucune règle métier et ne reçoit jamais de `tenant_id` du client.
 */

/** Bucket PRIVÉ des proxies. Lectures uniquement par URL signée à TTL court. */
export const PHOTO_PROXY_BUCKET = "hermes-photo-proxies";
/** TTL des URLs signées de proxy (secondes). Assez pour une session de revue. */
const SIGNED_URL_TTL_SECONDS = 300;

function asRecord(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(n) ? n : fallback;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function resolution(payload: Record<string, unknown>): PhotoToday["resolutionStatus"] {
  return (payload.resolution_status ?? "UNAUTHENTICATED") as PhotoToday["resolutionStatus"];
}

/** Projette le JSON `compute_photo_session_state` sur son type TS. */
function mapState(value: unknown): PhotoSessionState {
  const s = asRecord(value);
  const c = asRecord(s.counters);
  return {
    ok: Boolean(s.ok),
    sessionId: str(s.session_id),
    status: (str(s.status) ?? null) as PhotoSessionState["status"],
    statusRank: numOrNull(s.status_rank),
    nextAction: (str(s.next_action) ?? "NONE") as PhotoSessionState["nextAction"],
    blockedBy: str(s.blocked_by),
    counters: {
      assets: num(c.assets),
      proxyReady: num(c.proxy_ready),
      proxyFailed: num(c.proxy_failed),
      signals: num(c.signals),
      verdicts: num(c.verdicts),
      undecided: num(c.undecided),
      kept: num(c.kept),
      discarded: num(c.discarded),
      protected: num(c.protected),
      bestOfSeries: num(c.best_of_series),
      instructions: num(c.instructions),
    },
  };
}

async function callRpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    // Expected dormancy, not a failure: while the Studio migration is unapplied,
    // `get_photo_module_state` genuinely doesn't exist yet, so PostgREST reports
    // PGRST202. Only THIS exact (function, code) pair is downgraded — any other
    // code on this function, or any code on any other photo RPC, stays an error.
    const dormant = fn === "get_photo_module_state" && error.code === "PGRST202";
    logEvent(dormant ? "warn" : "error", "photo.rpc_error", { fn, code: error.code });
    return null;
  }
  return asRecord(data);
}

// --- Lectures ---------------------------------------------------------------

/**
 * État d'activation de la verticale. C'est le SEUL portillon d'affichage : tant
 * qu'un opérateur n'a pas activé le tenant, `enabled` est faux et aucune page,
 * aucun widget, aucune entrée de menu photo n'apparaît.
 */
export async function getPhotoModuleState(): Promise<PhotoModuleState> {
  const payload = await callRpc("get_photo_module_state", {});
  if (!payload) return { resolutionStatus: "UNAUTHENTICATED", tenantId: null, enabled: false };
  return {
    resolutionStatus: (payload.resolution_status ?? "UNAUTHENTICATED") as TenantResolutionStatus,
    tenantId: str(payload.tenant_id),
    enabled: Boolean(payload.enabled),
  };
}

export async function getPhotoToday(): Promise<ServiceResult<PhotoToday>> {
  const payload = await callRpc("get_photo_today", {});
  if (!payload) return { ok: false, provenance: "UNAVAILABLE", error: "RPC_ERROR" };
  const counters = asRecord(payload.counters);
  const sessions = Array.isArray(payload.sessions)
    ? (payload.sessions as Record<string, unknown>[])
    : [];
  return {
    ok: true,
    provenance: "REAL",
    data: {
      resolutionStatus: resolution(payload),
      tenantId: str(payload.tenant_id),
      counters: {
        sessionsActive: num(counters.sessions_active),
        sessionsToImport: num(counters.sessions_to_import),
        sessionsAwaitingShot: num(counters.sessions_awaiting_shot),
        photosAwaitingReview: num(counters.photos_awaiting_review),
        upsellOpportunities: num(counters.upsell_opportunities),
        upsellPotentialEur: num(counters.upsell_potential_eur),
      },
      sessions: sessions.map((s) => ({
        sessionId: String(s.session_id ?? ""),
        title: str(s.title),
        clientName: String(s.client_name ?? ""),
        sessionType: (s.session_type ?? "AUTRE") as PhotoToday["sessions"][number]["sessionType"],
        status: (s.status ?? "DRAFT") as PhotoToday["sessions"][number]["status"],
        scheduledAt: str(s.scheduled_at),
        state: mapState(s.state),
      })),
    },
  };
}

export async function getPhotoSessions(limit = 50): Promise<ServiceResult<PhotoSessions>> {
  const payload = await callRpc("get_photo_sessions", { p_limit: limit });
  if (!payload) return { ok: false, provenance: "UNAVAILABLE", error: "RPC_ERROR" };
  const rows = Array.isArray(payload.sessions)
    ? (payload.sessions as Record<string, unknown>[])
    : [];
  return {
    ok: true,
    provenance: "REAL",
    data: {
      resolutionStatus: resolution(payload),
      tenantId: str(payload.tenant_id),
      sessions: rows.map((s) => ({
        sessionId: String(s.session_id ?? ""),
        clientId: String(s.client_id ?? ""),
        clientName: String(s.client_name ?? ""),
        title: str(s.title),
        sessionType: (s.session_type ?? "AUTRE") as PhotoSessions["sessions"][number]["sessionType"],
        status: (s.status ?? "DRAFT") as PhotoSessions["sessions"][number]["status"],
        scheduledAt: str(s.scheduled_at),
        locationLabel: str(s.location_label),
        quoteAmountEur: numOrNull(s.quote_amount_eur),
        assetCount: num(s.asset_count),
        undecidedCount: num(s.undecided_count),
      })),
    },
  };
}

export async function getPhotoSessionDetail(
  sessionId: string,
): Promise<ServiceResult<PhotoSessionDetail>> {
  const payload = await callRpc("get_photo_session_detail", { p_session_id: sessionId });
  if (!payload) return { ok: false, provenance: "UNAVAILABLE", error: "RPC_ERROR" };
  const found = Boolean(payload.found);
  const s = asRecord(payload.session);
  const c = asRecord(payload.client);
  const instructions = Array.isArray(payload.instructions)
    ? (payload.instructions as Record<string, unknown>[])
    : [];
  return {
    ok: true,
    provenance: "REAL",
    data: {
      resolutionStatus: resolution(payload),
      found,
      session: found
        ? {
            sessionId: String(s.session_id ?? ""),
            title: str(s.title),
            sessionType: (s.session_type ?? "AUTRE") as NonNullable<
              PhotoSessionDetail["session"]
            >["sessionType"],
            status: (s.status ?? "DRAFT") as NonNullable<PhotoSessionDetail["session"]>["status"],
            scheduledAt: str(s.scheduled_at),
            locationLabel: str(s.location_label),
            notes: str(s.notes),
            quoteAmountEur: numOrNull(s.quote_amount_eur),
            depositPaidEur: num(s.deposit_paid_eur),
            balancePaidEur: num(s.balance_paid_eur),
            shotAt: str(s.shot_at),
            importedAt: str(s.imported_at),
            culledAt: str(s.culled_at),
            selectionApprovedAt: str(s.selection_approved_at),
            deliveredAt: str(s.delivered_at),
          }
        : null,
      client: found
        ? {
            clientId: String(c.client_id ?? ""),
            displayName: String(c.display_name ?? ""),
            preferredChannel: String(c.preferred_channel ?? "EMAIL"),
            lifetimeValueEur: num(c.lifetime_value_eur),
          }
        : null,
      instructions: instructions.map((i) => ({
        id: String(i.id ?? ""),
        instruction: String(i.instruction ?? ""),
        kind: (i.kind ?? "PROTECT") as PhotoSessionDetail["instructions"][number]["kind"],
        keyword: String(i.keyword ?? ""),
        isGlobal: Boolean(i.is_global),
        createdAt: str(i.created_at),
      })),
      state: found ? mapState(payload.state) : null,
    },
  };
}

/**
 * Grille de revue. Les chemins d'objet renvoyés par la façade sont transformés
 * ICI en URLs SIGNÉES à TTL court — aucune URL publique n'est jamais produite,
 * et le chemin brut ne sort pas du serveur.
 */
export async function getPhotoCullingReview(
  sessionId: string,
  limit = 200,
): Promise<ServiceResult<PhotoCullingReview>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_photo_culling_review", {
    p_session_id: sessionId,
    p_limit: limit,
  });
  if (error) {
    logEvent("error", "photo.rpc_error", { fn: "get_photo_culling_review", code: error.code });
    return { ok: false, provenance: "UNAVAILABLE", error: "RPC_ERROR" };
  }
  const payload = asRecord(data);
  const rows = Array.isArray(payload.items) ? (payload.items as Record<string, unknown>[]) : [];

  // Signature groupée : une seule requête Storage pour toute la grille.
  const paths = rows.flatMap((r) =>
    [str(r.proxy_path), str(r.thumb_path)].filter((p): p is string => p !== null),
  );
  const signedByPath = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage
      .from(PHOTO_PROXY_BUCKET)
      .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
    for (const entry of signed ?? []) {
      if (entry.path && entry.signedUrl) signedByPath.set(entry.path, entry.signedUrl);
    }
  }

  const items: PhotoReviewItem[] = rows.map((r) => ({
    assetId: String(r.asset_id ?? ""),
    filename: String(r.filename ?? ""),
    capturedAt: str(r.captured_at),
    proxyUrl: signedByPath.get(str(r.proxy_path) ?? "") ?? null,
    thumbUrl: signedByPath.get(str(r.thumb_path) ?? "") ?? null,
    proxyStatus: (r.proxy_status ?? "PENDING") as PhotoReviewItem["proxyStatus"],
    verdict: (str(r.verdict) ?? null) as PhotoReviewItem["verdict"],
    score: numOrNull(r.score),
    reasonCode: str(r.reason_code),
    isProtected: Boolean(r.is_protected),
    humanDecision: (str(r.human_decision) ?? null) as PhotoReviewItem["humanDecision"],
    sharpness: numOrNull(r.sharpness),
  }));

  return {
    ok: true,
    provenance: "REAL",
    data: {
      resolutionStatus: resolution(payload),
      found: Boolean(payload.found),
      sessionId: str(payload.session_id),
      items,
      state: payload.state ? mapState(payload.state) : null,
    },
  };
}

export async function getPhotoClients(limit = 100): Promise<ServiceResult<PhotoClients>> {
  const payload = await callRpc("get_photo_clients", { p_limit: limit });
  if (!payload) return { ok: false, provenance: "UNAVAILABLE", error: "RPC_ERROR" };
  const rows = Array.isArray(payload.clients) ? (payload.clients as Record<string, unknown>[]) : [];
  return {
    ok: true,
    provenance: "REAL",
    data: {
      resolutionStatus: resolution(payload),
      tenantId: str(payload.tenant_id),
      clients: rows.map((c) => ({
        clientId: String(c.client_id ?? ""),
        displayName: String(c.display_name ?? ""),
        status: String(c.status ?? "ACTIVE"),
        preferredChannel: String(c.preferred_channel ?? "EMAIL"),
        lifetimeValueEur: num(c.lifetime_value_eur),
        followUpDate: str(c.follow_up_date),
        sessionCount: num(c.session_count),
        lastSessionAt: str(c.last_session_at),
        memberCount: num(c.member_count),
        hasActiveConsent: Boolean(c.has_active_consent),
      })),
    },
  };
}

/** Instantané de valeur. `null` signifie NON MESURÉ et doit être affiché ainsi. */
export async function getPhotoValueSnapshot(): Promise<ServiceResult<PhotoValueSnapshot>> {
  const payload = await callRpc("get_photo_value_snapshot", {});
  if (!payload) return { ok: false, provenance: "UNAVAILABLE", error: "RPC_ERROR" };
  const baseline = asRecord(payload.baseline);
  return {
    ok: true,
    provenance: "REAL",
    data: {
      resolutionStatus: resolution(payload),
      baselineProvenance: (baseline.provenance ?? "NOT_MEASURED") as "REAL" | "NOT_MEASURED",
      baselineValue: numOrNull(baseline.value),
      baselineUnit: str(baseline.unit),
      photosReviewed: num(payload.photos_reviewed),
      sessionsProcessed: num(payload.sessions_processed),
      grossTimeSavedMinutes: numOrNull(payload.gross_time_saved_minutes),
      supervisionMinutes: num(payload.supervision_minutes),
      netTimeSavedMinutes: numOrNull(payload.net_time_saved_minutes),
      provenance: (payload.provenance ?? "UNAVAILABLE") as "DERIVED" | "UNAVAILABLE",
    },
  };
}

// --- Écritures --------------------------------------------------------------

function outcome(payload: Record<string, unknown> | null): PhotoWriteOutcome {
  if (!payload) return { ok: false, code: "RPC_ERROR" };
  return {
    ok: Boolean(payload.ok),
    code: String(payload.code ?? (payload.ok ? "OK" : "RPC_ERROR")),
    data: payload,
  };
}

/**
 * Crée une séance (client + type requis) ou met à jour une séance existante
 * (`sessionId` fourni ⇒ client et type sont ignorés côté base, aucune fiche
 * client n'est créée au passage).
 */
export async function upsertPhotoSession(input: {
  clientName?: string | null;
  sessionType?: string | null;
  scheduledAt?: string | null;
  title?: string | null;
  location?: string | null;
  sessionId?: string | null;
  status?: string | null;
}): Promise<PhotoWriteOutcome> {
  return outcome(
    await callRpc("upsert_photo_session", {
      p_client_name: input.clientName ?? null,
      p_session_type: input.sessionType ?? null,
      p_scheduled_at: input.scheduledAt ?? null,
      p_title: input.title ?? null,
      p_location: input.location ?? null,
      p_session_id: input.sessionId ?? null,
      p_status: input.status ?? null,
    }),
  );
}

export async function registerPhotoImport(
  sessionId: string,
  assets: Record<string, unknown>[],
): Promise<PhotoWriteOutcome> {
  return outcome(
    await callRpc("register_photo_import", { p_session_id: sessionId, p_assets: assets }),
  );
}

export async function recordPhotoCullingSignals(
  sessionId: string,
  signals: Record<string, unknown>[],
): Promise<PhotoWriteOutcome> {
  return outcome(
    await callRpc("record_photo_culling_signals", {
      p_session_id: sessionId,
      p_signals: signals,
    }),
  );
}

export async function applyPhotoCullingReview(
  sessionId: string,
  decisions: { asset_id: string; decision: "KEEP" | "DISCARD" }[],
  approveSelection = false,
): Promise<PhotoWriteOutcome> {
  return outcome(
    await callRpc("apply_photo_culling_review", {
      p_session_id: sessionId,
      p_decisions: decisions,
      p_approve_selection: approveSelection,
    }),
  );
}

export async function recordPhotoCullingInstruction(input: {
  sessionId: string | null;
  instruction: string;
  kind: string;
  keyword: string;
}): Promise<PhotoWriteOutcome> {
  return outcome(
    await callRpc("record_photo_culling_instruction", {
      p_session_id: input.sessionId,
      p_instruction: input.instruction,
      p_kind: input.kind,
      p_keyword: input.keyword,
    }),
  );
}

export async function recordPhotoConsent(input: {
  clientId: string;
  useCases: string[];
  mediaTypes: string[];
  identityScope: string;
  locationScope: string;
  includesMinors: boolean;
  guardianConsent: boolean;
  consentTextVersion: string;
  sessionId?: string | null;
  expiresAt?: string | null;
}): Promise<PhotoWriteOutcome> {
  return outcome(
    await callRpc("record_photo_consent", {
      p_client_id: input.clientId,
      p_use_cases: input.useCases,
      p_media_types: input.mediaTypes,
      p_identity_scope: input.identityScope,
      p_location_scope: input.locationScope,
      p_includes_minors: input.includesMinors,
      p_guardian_consent: input.guardianConsent,
      p_consent_text_version: input.consentTextVersion,
      p_session_id: input.sessionId ?? null,
      p_expires_at: input.expiresAt ?? null,
    }),
  );
}

/**
 * Téléverse les deux dérivés d'une photo dans le bucket privé, puis finalise.
 *
 * Le tenant est résolu SERVER-SIDE et le chemin construit ici : le navigateur ne
 * choisit jamais l'emplacement de stockage. En cas d'échec de finalisation, les
 * objets sont retirés (best effort) — on ne laisse pas d'objet orphelin non
 * référencé, et l'asset est marqué FAILED plutôt que d'être perdu.
 */
export async function uploadPhotoProxy(input: {
  sessionId: string;
  assetId: string;
  proxy: ArrayBuffer;
  thumb: ArrayBuffer;
}): Promise<PhotoWriteOutcome> {
  try {
    // Le tenant vient EXCLUSIVEMENT du serveur (`resolve_active_tenant` derrière
    // la façade) — il n'est jamais un paramètre d'appel côté client.
    const moduleState = await getPhotoModuleState();
    if (!moduleState.enabled || !moduleState.tenantId) {
      return { ok: false, code: "MODULE_DISABLED" };
    }
    const supabase = await createSupabaseServerClient();
    const base = `${moduleState.tenantId}/${input.sessionId}/${input.assetId}`;
    const proxyPath = `${base}/p1600.jpg`;
    const thumbPath = `${base}/t400.jpg`;

    const up1 = await supabase.storage
      .from(PHOTO_PROXY_BUCKET)
      .upload(proxyPath, input.proxy, { contentType: "image/jpeg", upsert: true });
    if (up1.error) {
      logEvent("error", "photo.proxy_upload_error", { code: up1.error.name });
      return { ok: false, code: "UPLOAD_FAILED" };
    }
    const up2 = await supabase.storage
      .from(PHOTO_PROXY_BUCKET)
      .upload(thumbPath, input.thumb, { contentType: "image/jpeg", upsert: true });
    if (up2.error) {
      await supabase.storage.from(PHOTO_PROXY_BUCKET).remove([proxyPath]);
      logEvent("error", "photo.thumb_upload_error", { code: up2.error.name });
      return { ok: false, code: "UPLOAD_FAILED" };
    }

    const finalized = outcome(
      await callRpc("finalize_photo_proxy", {
        p_asset_id: input.assetId,
        p_proxy_path: proxyPath,
        p_thumb_path: thumbPath,
        p_proxy_bytes: input.proxy.byteLength,
      }),
    );
    if (!finalized.ok) {
      await supabase.storage.from(PHOTO_PROXY_BUCKET).remove([proxyPath, thumbPath]);
      await callRpc("mark_photo_proxy_failed", { p_asset_id: input.assetId });
    }
    return finalized;
  } catch (err) {
    logEvent("error", "photo.proxy_exception", { message: (err as Error).message });
    return { ok: false, code: "EXCEPTION" };
  }
}
