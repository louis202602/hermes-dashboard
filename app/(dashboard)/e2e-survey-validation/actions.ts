"use server";

import { revalidatePath } from "next/cache";

import { requireAuthedUser } from "@/lib/dashboard/requestScope";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const E2E_SURVEY_ID = "00000000-0000-0000-0000-0000000e2e04";

export async function validateE2ESurveyAction(): Promise<void> {
  await requireAuthedUser();

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("validate_pv_site_survey", {
    p_survey_id: E2E_SURVEY_ID,
  });

  if (error) {
    throw new Error("La validation de la visite test a échoué.");
  }

  const result = data as { ok?: boolean; code?: string } | null;
  if (!result?.ok && result?.code !== "ALREADY_VALIDATED") {
    throw new Error(`Validation refusée : ${result?.code ?? "UNKNOWN"}`);
  }

  revalidatePath("/e2e-survey-validation");
}
