import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getSupabaseEnv } from "./env";

/**
 * Supabase client bound to the current request's cookies, for use in Server
 * Components, Server Actions, and Route Handlers. It runs as the authenticated
 * user (or anon), so RLS and RPC authorization apply — this app never uses the
 * service-role key.
 */
export async function createSupabaseServerClient() {
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
}
