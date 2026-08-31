"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AgendaActionState = {
  phase: "idle" | "success" | "error";
  message: string | null;
};

export const AGENDA_INITIAL_STATE: AgendaActionState = { phase: "idle", message: null };

const ERROR: Record<string, string> = {
  UNAUTHENTICATED: "Session expirée. Reconnectez-vous.",
  NO_TENANT: "Aucune entreprise active n’est associée à votre compte.",
  INVALID_EVENT: "Titre, date et heure de début sont obligatoires.",
  INVALID_END: "L’heure de fin doit être postérieure au début.",
  INVALID_TIMEZONE: "Le fuseau horaire de l’entreprise est invalide.",
  NOT_FOUND: "Rendez-vous introuvable.",
};

export async function createPvAgendaEventAction(
  _previous: AgendaActionState,
  formData: FormData,
): Promise<AgendaActionState> {
  const title = String(formData.get("title") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();
  const start = String(formData.get("start_time") ?? "").trim();
  const end = String(formData.get("end_time") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  if (!title || !date || !start) return { phase: "error", message: ERROR.INVALID_EVENT };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_pv_calendar_event_local", {
    p_title: title,
    p_date: date,
    p_start_time: start,
    p_end_time: end,
    p_notes: notes,
    p_is_all_day: false,
  });
  const payload = (data ?? {}) as Record<string, unknown>;
  if (error || !payload.ok) {
    const code = String(payload.code ?? error?.code ?? "UNAVAILABLE");
    return { phase: "error", message: ERROR[code] ?? `Création refusée (${code}).` };
  }
  revalidatePath("/agenda");
  return { phase: "success", message: "Rendez-vous ajouté à l’agenda réel." };
}

export async function cancelPvAgendaEventAction(formData: FormData): Promise<void> {
  const id = String(formData.get("event_id") ?? "").trim();
  if (!id) return;
  const supabase = await createSupabaseServerClient();
  await supabase.rpc("cancel_pv_calendar_event", { p_event_id: id });
  revalidatePath("/agenda");
}
