import "server-only";

type LogLevel = "info" | "warn" | "error";

/**
 * Minimal structured server-side logger. Emits single-line JSON so logs are
 * greppable and ready to forward to an observability backend (SW12 / Sentry)
 * in a later slice. Never logs secrets or full user records.
 */
export function logEvent(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const payload = JSON.stringify({ level, event, ...fields });

  if (level === "error") {
    console.error(payload);
  } else if (level === "warn") {
    console.warn(payload);
  } else {
    console.info(payload);
  }
}
