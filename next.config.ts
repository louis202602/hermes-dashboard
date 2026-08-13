import type { NextConfig } from "next";

import { STATIC_SECURITY_HEADERS } from "./lib/security/headers";

const nextConfig: NextConfig = {
  // Do not leak the framework via the `X-Powered-By` header.
  poweredByHeader: false,
  experimental: {
    // Hermès composer attachments (Phase B) upload ONE file per Server Action
    // call. The largest single-file cap is 25 MiB (audio); this raises the
    // default 1 MB Server Action body limit just enough to cover that file plus
    // the multipart/form-data boundary + header overhead. Per-category caps and
    // fail-closed validation remain enforced server-side.
    serverActions: {
      bodySizeLimit: "26mb",
    },
  },
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
