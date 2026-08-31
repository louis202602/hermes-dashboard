"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function configureQontoCredentialsAction(formData: FormData): Promise<void> {
  const clientId = String(formData.get("client_id") ?? "").trim();
  const clientSecret = String(formData.get("client_secret") ?? "").trim();

  if (clientId.length < 3 || clientSecret.length < 8) {
    redirect("/integrations?qonto_setup=invalid");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("configure_qonto_oauth_credentials_self", {
    p_client_id: clientId,
    p_client_secret: clientSecret,
  });
  const payload = (data ?? {}) as Record<string, unknown>;
  if (error || !payload.ok) {
    redirect(`/integrations?qonto_setup=${encodeURIComponent(String(payload.code ?? error?.code ?? "error"))}`);
  }

  revalidatePath("/integrations");
  redirect("/integrations?qonto_setup=ok");
}
