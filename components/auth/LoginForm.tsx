"use client";

import { useActionState } from "react";

import { signInAction, type SignInState } from "@/app/login/actions";

const initialState: SignInState = { error: "" };

export default function LoginForm() {
  const [state, formAction, pending] = useActionState(
    signInAction,
    initialState,
  );

  return (
    <form action={formAction} className="login-form">
      <label className="login-field">
        <span>Adresse e-mail</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          placeholder="vous@entreprise.com"
        />
      </label>

      <label className="login-field">
        <span>Mot de passe</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
        />
      </label>

      {state.error ? (
        <p className="login-error" role="alert" aria-live="polite">
          {state.error}
        </p>
      ) : null}

      <button type="submit" className="login-submit" disabled={pending}>
        {pending ? "Connexion…" : "Se connecter"}
      </button>
    </form>
  );
}
