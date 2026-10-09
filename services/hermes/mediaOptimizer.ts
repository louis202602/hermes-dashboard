import "server-only";

import { logEvent } from "@/lib/observability/log";
import { mapPreviews, mapState } from "@/lib/media-optimizer/map";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ServiceResult } from "@/types/hermes";
import type {
  MediaOptimizerState,
  MediaPreviewsResult,
  MediaRightsStatus,
  MediaWriteOutcome,
} from "@/types/mediaOptimizer";

/**
 * MEDIA-OPT — Accès serveur au Media Optimizer.
 *
 * Chaque fonction n'est qu'un appel à une façade `SECURITY DEFINER` : le tenant
 * et les droits sont décidés EN BASE à partir de la session. Aucun `tenant_id`
 * ne vient du client, et rien ici ne publie. La normalisation des charges
 * utiles vit dans `lib/media-optimizer/map.ts` (pure, testée).
 */

function rec(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
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
  return { ok: true, provenance: "REAL", data: mapState(payload) };
}

/**
 * Aperçus d'un média, chargés À LA DEMANDE (images base64 lourdes : jamais dans la liste).
 * Lecture seule ; le tenant est résolu en base à partir de la session.
 */
export async function getMediaOptimizerPreviews(jobId: string): Promise<MediaPreviewsResult> {
  const payload = await callRpc("get_media_optimizer_previews", { p_job: jobId });
  if (!payload) return { ok: false, code: "RPC_ERROR" };
  const status = String(payload.resolution_status ?? "UNKNOWN");
  if (status === "UNAUTHENTICATED") return { ok: false, code: "UNAUTHENTICATED" };
  if (status !== "OK") return { ok: false, code: "NO_TENANT" };
  return { ok: true, previews: mapPreviews(payload.previews) };
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
