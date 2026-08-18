"use server";

import { revalidatePath } from "next/cache";

import { parseCullingInstruction, type InstructionKind } from "@/lib/photo/instructions";
import { validateConsentForm } from "@/lib/photo/consent";
import {
  applyPhotoCullingReview,
  getPhotoModuleState,
  recordPhotoConsent,
  recordPhotoCullingInstruction,
  recordPhotoCullingSignals,
  registerPhotoImport,
  uploadPhotoProxy,
  upsertPhotoSession,
} from "@/services/hermes/photo";
import { PHOTO_SESSION_TYPES } from "@/types/photo";
import type { PhotoWriteOutcome } from "@/types/photo";

/**
 * PHOTO-P0 — Server Actions de la verticale.
 *
 * Toutes suivent la même règle : elles ne décident rien, elles transmettent à une
 * façade `SECURITY DEFINER` qui décide. Aucune n'accepte de `tenant_id`, aucune
 * ne contourne le portillon d'activation, aucune ne supprime de fichier.
 *
 * Messages d'erreur : le code technique de la base est traduit en une phrase
 * honnête. Un échec n'est jamais présenté comme un succès.
 */

const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Session expirée. Reconnectez-vous.",
  NO_TENANT: "Aucun studio n’est associé à votre compte.",
  ACCESS_DENIED: "Accès refusé.",
  AMBIGUOUS_TENANT_REQUIRE_SELECTION: "Plusieurs studios disponibles : sélection requise.",
  MODULE_DISABLED: "La verticale Studio n’est pas activée pour ce studio.",
  NOT_FOUND: "Séance introuvable.",
  BAD_PAYLOAD: "Données invalides.",
  BATCH_TOO_LARGE: "Lot trop volumineux — découpez l’import.",
  BAD_CLIENT_NAME: "Le nom du client est requis.",
  BAD_SESSION_TYPE: "Type de séance invalide.",
  BAD_STATUS: "Statut de séance invalide.",
  BAD_INSTRUCTION: "Consigne vide ou trop longue.",
  BAD_KEYWORD: "Sujet de la consigne introuvable.",
  BAD_KIND: "Nature de consigne invalide.",
  MINOR_WITHOUT_GUARDIAN:
    "Un consentement couvrant des mineurs exige le consentement du représentant légal.",
  PATH_OUT_OF_SCOPE: "Chemin de stockage refusé.",
  UPLOAD_FAILED: "Le téléversement a échoué.",
  RPC_ERROR: "Le service est indisponible. Réessayez plus tard.",
  EXCEPTION: "Le service est indisponible. Réessayez plus tard.",
};

export type PhotoActionState = {
  phase: "idle" | "ok" | "error";
  code?: string;
  message?: string;
  sessionId?: string;
};

function toState(result: PhotoWriteOutcome, sessionId?: string): PhotoActionState {
  if (result.ok) {
    return { phase: "ok", code: result.code, sessionId };
  }
  return {
    phase: "error",
    code: result.code,
    message: ERROR_MESSAGES[result.code] ?? "Action refusée.",
  };
}

/** Créer une séance depuis le formulaire. */
export async function createPhotoSessionAction(
  _prev: PhotoActionState,
  formData: FormData,
): Promise<PhotoActionState> {
  const clientName = String(formData.get("client_name") ?? "").trim();
  const sessionType = String(formData.get("session_type") ?? "").trim();
  const scheduledAt = String(formData.get("scheduled_at") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();

  if (clientName.length === 0) {
    return { phase: "error", code: "BAD_CLIENT_NAME", message: ERROR_MESSAGES.BAD_CLIENT_NAME };
  }
  if (!(PHOTO_SESSION_TYPES as readonly string[]).includes(sessionType)) {
    return { phase: "error", code: "BAD_SESSION_TYPE", message: ERROR_MESSAGES.BAD_SESSION_TYPE };
  }

  const result = await upsertPhotoSession({
    clientName,
    sessionType,
    scheduledAt: scheduledAt.length > 0 ? new Date(scheduledAt).toISOString() : null,
    title: title.length > 0 ? title : null,
    location: location.length > 0 ? location : null,
  });
  if (result.ok) revalidatePath("/seances");
  return toState(result, (result.data?.session_id as string) ?? undefined);
}

/** Déclarer la séance réalisée (« j'ai terminé la séance Dupont »). */
export async function markSessionShotAction(sessionId: string): Promise<PhotoActionState> {
  if (!sessionId) return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  const result = await upsertPhotoSession({ sessionId, status: "SHOT" });
  if (result.ok) revalidatePath(`/seances/${sessionId}`);
  return toState(result, sessionId);
}

/** Enregistrer les références d'un lot importé. Renvoie sha256 → asset_id. */
export async function registerImportAction(
  sessionId: string,
  assets: {
    source_reference: string;
    original_filename: string;
    file_sha256: string;
    captured_at?: string | null;
    camera_model?: string | null;
    lens_model?: string | null;
    iso?: number | null;
    width?: number | null;
    height?: number | null;
  }[],
): Promise<{ ok: boolean; code: string; assets: { file_sha256: string; asset_id: string }[] }> {
  const result = await registerPhotoImport(sessionId, assets);
  const mapping = Array.isArray(result.data?.assets)
    ? (result.data?.assets as { file_sha256: string; asset_id: string }[])
    : [];
  return { ok: result.ok, code: result.code, assets: mapping };
}

/**
 * Téléverser proxy + vignette d'UNE photo. Les octets transitent par le serveur
 * pour que le tenant et le chemin de stockage restent décidés côté serveur.
 * (Compromis assumé : un envoi direct navigateur → Storage serait plus rapide
 * mais imposerait d'exposer le tenant au client. Voir le rapport.)
 */
export async function uploadPhotoProxyAction(formData: FormData): Promise<PhotoActionState> {
  const sessionId = String(formData.get("session_id") ?? "");
  const assetId = String(formData.get("asset_id") ?? "");
  const proxy = formData.get("proxy");
  const thumb = formData.get("thumb");

  if (!sessionId || !assetId || !(proxy instanceof File) || !(thumb instanceof File)) {
    return { phase: "error", code: "BAD_PAYLOAD", message: ERROR_MESSAGES.BAD_PAYLOAD };
  }

  const result = await uploadPhotoProxy({
    sessionId,
    assetId,
    proxy: await proxy.arrayBuffer(),
    thumb: await thumb.arrayBuffer(),
  });
  return toState(result, sessionId);
}

/** Enregistrer les mesures de la passe 1 ; la base en dérive les verdicts. */
export async function recordSignalsAction(
  sessionId: string,
  signals: {
    asset_id: string;
    sharpness: number;
    clip_low: number;
    clip_high: number;
    brightness: number;
    ahash: string;
    dhash: string;
  }[],
): Promise<PhotoActionState> {
  const result = await recordPhotoCullingSignals(sessionId, signals);
  if (result.ok) revalidatePath(`/seances/${sessionId}/tri`);
  return toState(result, sessionId);
}

/** Appliquer les décisions humaines de tri (et éventuellement valider la sélection). */
export async function applyReviewAction(
  sessionId: string,
  decisions: { asset_id: string; decision: "KEEP" | "DISCARD" }[],
  approveSelection = false,
): Promise<PhotoActionState & { undecidedRemaining?: number; selectionApproved?: boolean }> {
  const result = await applyPhotoCullingReview(sessionId, decisions, approveSelection);
  if (result.ok) {
    revalidatePath(`/seances/${sessionId}/tri`);
    revalidatePath(`/seances/${sessionId}`);
  }
  return {
    ...toState(result, sessionId),
    undecidedRemaining: Number(result.data?.undecided_remaining ?? 0),
    selectionApproved: Boolean(result.data?.selection_approved),
  };
}

/**
 * Ajouter une consigne de tri en langage naturel.
 *
 * `kind` explicite l'emporte sur l'analyse automatique. Si la phrase est
 * ambiguë et qu'aucun `kind` n'est fourni, on REFUSE avec un message clair —
 * on ne devine jamais, et surtout jamais dans le sens « écarter ».
 */
export async function addCullingInstructionAction(
  sessionId: string | null,
  text: string,
  explicitKind?: InstructionKind,
  explicitKeyword?: string,
): Promise<PhotoActionState> {
  const parsed = parseCullingInstruction(text);
  const kind = explicitKind ?? parsed?.kind ?? null;
  const keyword = (explicitKeyword ?? parsed?.keyword ?? "").trim();

  if (!kind || keyword.length === 0) {
    return {
      phase: "error",
      code: "AMBIGUOUS_INSTRUCTION",
      message:
        "Consigne non comprise. Précisez le sujet et s’il faut protéger, privilégier ou écarter.",
    };
  }

  const result = await recordPhotoCullingInstruction({
    sessionId,
    instruction: text.trim(),
    kind,
    keyword,
  });
  if (result.ok && sessionId) revalidatePath(`/seances/${sessionId}/tri`);
  return toState(result, sessionId ?? undefined);
}

/** Enregistrer un consentement média. Double validation : ici puis en base. */
export async function recordConsentAction(
  _prev: PhotoActionState,
  formData: FormData,
): Promise<PhotoActionState> {
  const clientId = String(formData.get("client_id") ?? "");
  const useCases = formData.getAll("use_case").map(String);
  const mediaTypes = formData.getAll("media_type").map(String);
  const identityScope = String(formData.get("identity_scope") ?? "NONE");
  const locationScope = String(formData.get("location_scope") ?? "NONE");
  const includesMinors = formData.get("includes_minors") === "on";
  const guardianConsent = formData.get("guardian_consent") === "on";
  const consentTextVersion = String(formData.get("consent_text_version") ?? "").trim();

  if (!clientId) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }

  const validation = validateConsentForm({
    useCases,
    mediaTypes,
    identityScope,
    locationScope,
    includesMinors,
    guardianConsent,
    consentTextVersion,
  });
  if (!validation.ok) {
    return { phase: "error", code: validation.code, message: validation.message };
  }

  const result = await recordPhotoConsent({
    clientId,
    useCases,
    mediaTypes,
    identityScope,
    locationScope,
    includesMinors,
    guardianConsent,
    consentTextVersion,
  });
  if (result.ok) revalidatePath("/clients");
  return toState(result);
}

/** Lecture d'appoint pour les composants client (activation + tenant courant). */
export async function photoModuleStateAction(): Promise<{ enabled: boolean }> {
  const state = await getPhotoModuleState();
  return { enabled: state.enabled };
}
