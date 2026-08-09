"use server";

import { redirect } from "next/navigation";

import { logEvent } from "@/lib/observability/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SignInState = { error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Password sign-in. Input is validated; errors are intentionally generic so we
 * never reveal whether an account exists. Authentication and any downstream
 * authorization are enforced by Supabase — not by the UI.
 */
export async function signInAction(
  _prevState: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!EMAIL_RE.test(email) || password.length === 0) {
    return { error: "Adresse e-mail ou mot de passe invalide." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    logEvent("warn", "auth.signin_failed", { code: error.code });
    return { error: "Identifiants invalides." };
  }

  logEvent("info", "auth.signin_ok", {});
  redirect("/");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
