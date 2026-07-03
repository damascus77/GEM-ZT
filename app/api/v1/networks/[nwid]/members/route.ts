import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api/auth';
import { handleRouteError } from '@/lib/api/errors';
import { listMembers } from '@/lib/services/members';

type Ctx = { params: { nwid: string } };

export async function GET(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    return NextResponse.json({ members: await listMembers(params.nwid) });
  } catch (e) {
    return handleRouteError(e);
  }
}
