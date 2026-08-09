import { redirect } from "next/navigation";

import LoginForm from "@/components/auth/LoginForm";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Connexion — Hermès OS",
};

export default async function LoginPage() {
  // Already authenticated users skip the login screen.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/");
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <span className="login-eyebrow">HERMÈS OS</span>
        <h1>Poste de commande</h1>
        <p className="login-subtitle">
          Connectez-vous pour accéder à votre tableau de bord.
        </p>
        <LoginForm />
      </section>
    </main>
  );
}
