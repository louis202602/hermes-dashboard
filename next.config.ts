import type { NextConfig } from "next";

import { STATIC_SECURITY_HEADERS } from "./lib/security/headers";

const nextConfig: NextConfig = {
  // Do not leak the framework via the `X-Powered-By` header.
  poweredByHeader: false,
  async headers() {
    return [
      {
        // Static security headers on every response. The per-request
        // Content-Security-Policy (nonce-based) is set in `proxy.ts`.
        source: "/:path*",
        headers: [...STATIC_SECURITY_HEADERS],
      },
    ];
  },
};

export default nextConfig;
