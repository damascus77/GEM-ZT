import { requireSuperAdmin } from '@/lib/api/authz';
import { handleRouteError } from '@/lib/api/errors';
import { collectMetrics, formatMetrics } from '@/lib/services/metrics';

export async function GET(req: Request) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof Response) return auth;
  try {
    const body = formatMetrics(await collectMetrics());
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
