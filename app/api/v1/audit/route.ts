import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api/auth';
import { handleRouteError } from '@/lib/api/errors';
import { listAuditLog } from '@/lib/services/audit';

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const limitParam = new URL(req.url).searchParams.get('limit');
    const limit = limitParam ? Number.parseInt(limitParam, 10) || 100 : 100;
    return NextResponse.json({ entries: await listAuditLog(limit) });
  } catch (e) {
    return handleRouteError(e);
  }
}
