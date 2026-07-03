import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api/auth';
import { handleRouteError } from '@/lib/api/errors';
import { listPendingMembers } from '@/lib/services/pending';

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    return NextResponse.json({ pending: await listPendingMembers() });
  } catch (e) {
    return handleRouteError(e);
  }
}
