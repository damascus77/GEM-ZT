import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/api/auth';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { getDb } from '@/lib/db/client';
import { logAudit } from '@/lib/services/audit';
import { verifyPassword } from '@/lib/services/auth';

const disableSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
  })
  .strict();

export async function POST(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const body = disableSchema.parse(await req.json());
    const user = await getDb().user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (!user.totpEnabled) {
      return apiError('TOTP_NOT_ENABLED', 'Two-factor authentication is not enabled.', 409);
    }
    if (!(await verifyPassword(user.passwordHash, body.currentPassword))) {
      return apiError('CURRENT_PASSWORD_INVALID', 'Current password is incorrect.', 400);
    }
    await getDb().user.update({
      where: { id: user.id },
      data: { totpSecret: null, totpEnabled: false },
    });
    await logAudit({
      userId: user.id,
      action: 'user.totp_disable',
      targetType: 'user',
      targetId: user.id,
    });
    return NextResponse.json({ enabled: false });
  } catch (e) {
    return handleRouteError(e);
  }
}
