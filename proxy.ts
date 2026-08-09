import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  NONCE_HEADER,
  buildContentSecurityPolicy,
} from "@/lib/security/headers";

/**
 * Next.js 16 Proxy (the renamed `middleware` convention). Its ONLY responsibility
 * in Phase 1 is security: it generates a per-request nonce and sets a strict
 * Content-Security-Policy. It performs NO authentication or route protection —
 * there is no auth yet, so adding gating here would be artificial. Route
 * protection is deferred to Phase 2 (see `types/routing.ts`).
 */
export function proxy(request: NextRequest) {
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
