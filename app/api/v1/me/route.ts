import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api/auth';
import { handleRouteError } from '@/lib/api/errors';

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const { user } = auth;
    return NextResponse.json({
      user: { id: user.id, username: user.username, role: user.role, totpEnabled: user.totpEnabled },
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
