export const dynamic = 'force-dynamic';

export async function GET() {
  const upstream = await fetch('https://smubxqorirlfldatzmym.supabase.co/functions/v1/hermes-sql-recovery-temp', { cache: 'no-store' });
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    },
  });
}
