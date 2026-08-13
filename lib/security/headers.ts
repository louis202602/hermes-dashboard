/**
 * Security header primitives shared by `next.config.ts` (static headers) and
 * `proxy.ts` (per-request Content-Security-Policy with a nonce).
 *
 * No business logic — technical primitives only.
 */

/** Request header used to pass the per-request CSP nonce to the render layer. */
export const NONCE_HEADER = "x-nonce";

/**
 * Static security headers, safe to apply to every response (including static
 * assets). These carry no per-request state, so they live in `next.config.ts`.
 *
 * HSTS is appropriate on Vercel (HTTPS-only). Browsers ignore it over plain HTTP
 * (e.g. localhost in dev), so it is harmless there. `preload` is intentionally
 * omitted — it is a strong, hard-to-reverse commitment that should be opted into
 * deliberately, not hardcoded.
 */
export const STATIC_SECURITY_HEADERS: ReadonlyArray<{
  key: string;
  value: string;
}> = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    // `microphone=(self)` enables the Hermès voice interface (browser-native
    // Web Speech capture) for same-origin only; cross-origin frames stay denied.
    // Camera / geolocation / topics remain fully disabled.
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=(), browsing-topics=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

/**
 * Build a per-request Content-Security-Policy using a nonce.
 *
 * - `script-src` stays strict: `'nonce-<n>'` + `'strict-dynamic'`, NO
 *   `'unsafe-inline'`. This is the real XSS protection and is compatible with
 *   the inline anti-FOUC theme script (which is nonced in the layout).
 * - `style-src` allows `'unsafe-inline'` — a demonstrated technical necessity:
 *   the dashboard renders dynamic inline `style` attributes (e.g. progress bar
 *   width) and relies on framework/library styling. Style injection is low
 *   severity compared to script injection.
 * - `'unsafe-eval'` is added only in development, where React uses `eval` for
 *   richer error stacks. It is never present in production.
 */
export function buildContentSecurityPolicy(
  nonce: string,
  isDev: boolean,
): string {
  const directives: string[] = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${
      isDev ? " 'unsafe-eval'" : ""
    }`,
    "style-src 'self' 'unsafe-inline'",
    // `https:` permits externally-hosted, operator-configured TENANT LOGOS
    // (images only — scripts stay strictly nonce-based). Same-origin, data: and
    // blob: are also allowed.
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];

  if (!isDev) {
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
}
