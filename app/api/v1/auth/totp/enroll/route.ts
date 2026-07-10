import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api/auth';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { getDb } from '@/lib/db/client';
import { generateTotpSecret, otpauthUri } from '@/lib/services/totp';

export async function POST(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    // Refuse to overwrite an already-confirmed secret: a stolen session could
    // otherwise silently rotate the second factor, and an accidental re-enroll
    // would lock the user out (their live authenticator would stop matching
    // while totpEnabled stays true). Rotating enabled TOTP requires a disable
    // flow first (not yet implemented).
    const current = await getDb().user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (current.totpEnabled) {
      return apiError(
        'TOTP_ALREADY_ENABLED',
        'Two-factor authentication is already enabled. Disable it before re-enrolling.',
        409
      );
    }
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
