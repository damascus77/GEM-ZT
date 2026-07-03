import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/api/auth';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { getDb } from '@/lib/db/client';
import { verifyTotp } from '@/lib/services/totp';

const enableSchema = z
  .object({
    code: z.string().min(1).max(16),
  })
  .strict();

export async function POST(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const body = enableSchema.parse(await req.json());
    const user = await getDb().user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (!user.totpSecret || !verifyTotp(user.totpSecret, body.code)) {
      return apiError('INVALID_TOTP', 'Invalid or expired TOTP code.', 400);
    }
    await getDb().user.update({
      where: { id: auth.user.id },
      data: { totpEnabled: true },
    });
    return NextResponse.json({ enabled: true });
  } catch (e) {
    return handleRouteError(e);
  }
}
