import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  NONCE_HEADER,
  buildContentSecurityPolicy,
} from "@/lib/security/headers";
import { refreshSupabaseSession } from "@/lib/supabase/session";

/**
 * Next.js 16 Proxy (the renamed `middleware` convention). Responsibilities:
 *  1. Security: generate a per-request nonce and set a strict CSP.
 *  2. Auth: refresh the Supabase session cookies so Server Components see a
 *     current session. It does NOT gate routes — page-level server checks are
 *     the enforcement boundary (the frontend is never a security boundary).
 */
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const csp = buildContentSecurityPolicy(nonce, isDev);

  // Pass the nonce to the render layer and expose the CSP on the request so
  // Next.js applies the nonce to its own framework/inline scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);

  // Refresh auth cookies onto this same response (which also carries the CSP).
  await refreshSupabaseSession(request, response);

  return response;
}

export const config = {
  matcher: [
    /*
     * Run on document requests only. Exclude API routes, Next.js static assets,
     * the image optimizer, the favicon, and link prefetches (which don't need
     * the CSP document header).
     */
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
