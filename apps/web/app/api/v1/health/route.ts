import { checkDatabase } from '@lunch/db';
import { healthResponse } from '@lunch/contracts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  let ready = false;
  try {
    ready = await checkDatabase();
  } catch {
    /* Never disclose credentials or driver errors. */
  }
  return Response.json(
    healthResponse.parse({
      status: ready ? 'ok' : 'unavailable',
      database: ready ? 'ok' : 'unavailable',
      service: 'web',
    }),
    {
      status: ready ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
