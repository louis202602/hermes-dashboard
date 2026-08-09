/**
 * Reads and validates the public Supabase client configuration.
 *
 * These values are safe to expose to the browser: all access to the `hermes_os`
 * business schema is enforced server-side by Postgres RLS and SECURITY DEFINER
 * RPCs. The service-role key is never used by this app.
 */
export function getSupabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase configuration: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example).",
    );
  }

  return { url, anonKey };
}
