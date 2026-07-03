import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api/auth';
import { handleRouteError } from '@/lib/api/errors';
import { getDb } from '@/lib/db/client';
import { generateTotpSecret, otpauthUri } from '@/lib/services/totp';

export async function POST(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    // Overwrites any prior un-confirmed secret; totpEnabled stays false until
    // the code is verified via /auth/totp/enable.
    const secret = generateTotpSecret();
    await getDb().user.update({
      where: { id: auth.user.id },
      data: { totpSecret: secret },
    });
    return NextResponse.json({ secret, otpauthUri: otpauthUri(secret, auth.user.username) });
  } catch (e) {
    return handleRouteError(e);
  }
}
