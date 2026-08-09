import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";

import { getSupabaseEnv } from "./env";

/**
 * Refreshes the Supabase auth session at the edge/proxy layer. Reads auth
 * cookies from the incoming request and writes any refreshed cookies onto the
 * outgoing response, keeping Server Components in sync. Called from `proxy.ts`.
 *
 * Per @supabase/ssr guidance, no logic runs between client creation and
 * `getUser()`, and the caller's response object (which also carries the CSP
 * headers) is the one mutated with refreshed cookies.
 */
export async function refreshSupabaseSession(
  request: NextRequest,
  response: NextResponse,
): Promise<void> {
  const { url, anonKey } = getSupabaseEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  await supabase.auth.getUser();
}
