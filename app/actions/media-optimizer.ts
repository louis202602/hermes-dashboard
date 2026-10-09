"use server";

import { revalidatePath } from "next/cache";

import {
  activatePublishStop,
  getMediaOptimizerPreviews,
  requestMediaOptimization,
  setMediaRights,
} from "@/services/hermes/mediaOptimizer";
import type { MediaPreviewsResult, MediaRightsStatus } from "@/types/mediaOptimizer";

/**
 * MEDIA-OPT — Server Actions. Elles ne décident rien : elles valident la forme
 * des entrées puis transmettent à une façade `SECURITY DEFINER`. Aucune
 * n'accepte de `tenant_id`, et aucune ne publie.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = "/integrations/mediatheque";

function jobId(formData: FormData): string | null {
  const id = String(formData.get("job_id") ?? "");
  return UUID.test(id) ? id : null;
}

/** Bouton « Optimiser maintenant » : met le fichier en file d'attente, indépendamment de toute publication. */
export async function requestOptimizationAction(formData: FormData): Promise<void> {
  const id = jobId(formData);
  if (!id) return;
  const pad = formData.get("pad_vertical") === "on";
  const net = String(formData.get("network") ?? "");
  await requestMediaOptimization(id, pad, net === "instagram" || net === "facebook" ? net : null);
  revalidatePath(PAGE);
}

/** Décision de droits : toujours humaine, jamais automatique. */
export async function setRightsAction(formData: FormData): Promise<void> {
  const id = jobId(formData);
  const status = String(formData.get("status") ?? "") as MediaRightsStatus;
  if (!id || !["authorized", "rejected", "pending_review"].includes(status)) return;
  const note = String(formData.get("note") ?? "").trim().slice(0, 500) || null;
  await setMediaRights(id, status, note);
  revalidatePath(PAGE);
}

/**
 * Chargement à la demande des aperçus avant/après d'un média (lecture seule).
 * Appelée par la visionneuse ; ne modifie rien et ne publie rien.
 */
export async function loadMediaPreviewsAction(id: string): Promise<MediaPreviewsResult> {
  if (!UUID.test(String(id))) return { ok: false, code: "INVALID_ID" };
  return getMediaOptimizerPreviews(id);
}

export async function activateStopAction(): Promise<void> {
  await activatePublishStop("STOP activé depuis la médiathèque");
  revalidatePath(PAGE);
}
