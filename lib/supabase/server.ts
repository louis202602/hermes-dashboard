import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

import { getSupabaseEnv } from "./env";

/**
 * Supabase client bound to the current request's cookies, for use in Server
 * Components, Server Actions, and Route Handlers. It runs as the authenticated
 * user (or anon), so RLS and RPC authorization apply — this app never uses the
 * service-role key.
 *
 * `cache()`-wrapped so every call within one request returns the SAME client
 * instance. Without this, each call site (layout, every service, every gated
 * page) built its OWN GoTrue client from the same incoming cookies; when the
 * access token was expired, several of them raced to redeem the same
 * single-use refresh token in parallel — the loser(s) got
 * `refresh_token_not_found` and fell back to the `anon` role, which every
 * protected RPC correctly refuses (42501). One shared client means at most
 * one refresh attempt per request, so the existing `if (!user) redirect(...)`
 * gates see a consistent, authoritative session before any business RPC runs.
 */
export const createSupabaseServerClient = cache(async function createSupabaseServerClient() {
  const { url, anonKey } = getSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // `setAll` was called from a Server Component where cookies are
          // read-only. Session refresh happens in `proxy.ts`, so this is safe
          // to ignore.
        }
      },
    },
  });
});
