import "server-only";

import { logEvent } from "@/lib/observability/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ServiceResult } from "@/types/hermes";
import type {
  MediaJobStatus,
  MediaOptimizerJob,
  MediaOptimizerState,
  MediaRightsStatus,
  MediaWriteOutcome,
} from "@/types/mediaOptimizer";

/**
 * MEDIA-OPT — Accès serveur au Media Optimizer.
 *
 * Chaque fonction n'est qu'un appel à une façade `SECURITY DEFINER` : le tenant
 * et les droits sont décidés EN BASE à partir de la session. Aucun `tenant_id`
 * ne vient du client, et rien ici ne publie.
 */

function rec(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}
function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(n) ? n : null;
}
function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function boolOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function mapJob(raw: unknown): MediaOptimizerJob {
  const j = rec(raw);
  return {
    id: String(j.id),
    mediaId: strOrNull(j.media_id),
    sourceName: String(j.source_name ?? "—"),
    folderLabel: strOrNull(j.folder_label),
    kind: (strOrNull(j.kind) as MediaOptimizerJob["kind"]) ?? null,
    network: (strOrNull(j.network) ?? "instagram") as MediaOptimizerJob["network"],
    status: (strOrNull(j.status) ?? "discovered") as MediaJobStatus,
    rightsStatus: (strOrNull(j.rights_status) ?? "pending_review") as MediaRightsStatus,
    rightsNote: strOrNull(j.rights_note),
    trigger: (strOrNull(j.trigger) ?? "auto") as MediaOptimizerJob["trigger"],
    optimizerStatus: strOrNull(j.optimizer_status),
    sizeBefore: numOrNull(j.size_before),
    sizeAfter: numOrNull(j.size_after),
    reductionPct: numOrNull(j.reduction_pct),
    encodeSec: numOrNull(j.encode_sec),
    peakRamMb: numOrNull(j.peak_ram_mb),
    ssimMin: numOrNull(j.ssim_min),
    igOk: boolOrNull(j.ig_ok),
    fbOk: boolOrNull(j.fb_ok),
    error: strOrNull(j.error),
    attempts: numOrNull(j.attempts) ?? 0,
    updatedAt: String(j.updated_at ?? ""),
  };
}

async function callRpc(fn: string, args: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    logEvent("error", "media_optimizer.rpc_error", { fn, code: error.code });
    return null;
  }
  return rec(data);
}

export async function getMediaOptimizerState(): Promise<ServiceResult<MediaOptimizerState>> {
  const payload = await callRpc("get_media_optimizer_state", { p_limit: 100 });
  if (!payload) return { ok: false, provenance: "UNAVAILABLE", error: "RPC_ERROR" };
  const jobs = Array.isArray(payload.jobs) ? payload.jobs.map(mapJob) : [];
  return {
    ok: true,
    provenance: "REAL",
    data: {
      resolutionStatus: String(payload.resolution_status ?? "UNAUTHENTICATED"),
      publishStop: payload.publish_stop !== false,
      jobs,
    },
  };
}

async function write(fn: string, args: Record<string, unknown>): Promise<MediaWriteOutcome> {
  const payload = await callRpc(fn, args);
  if (!payload) return { ok: false, code: "RPC_ERROR" };
  return { ok: payload.ok === true, code: String(payload.code ?? "UNKNOWN") };
}

export const requestMediaOptimization = (jobId: string, padVertical: boolean, network: string | null) =>
  write("request_media_optimization", { p_job_id: jobId, p_pad_vertical: padVertical, p_network: network });

export const setMediaRights = (jobId: string, status: MediaRightsStatus, note: string | null) =>
  write("set_media_rights", { p_job_id: jobId, p_status: status, p_note: note });

export const activatePublishStop = (reason: string | null) => write("activate_publish_stop", { p_reason: reason });
