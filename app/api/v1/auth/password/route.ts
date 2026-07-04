import { z } from 'zod';
import { requireAuth } from '@/lib/api/auth';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { getDb } from '@/lib/db/client';
import { logAudit } from '@/lib/services/audit';
import { invalidateOtherSessions, SESSION_COOKIE, setPassword, verifyPassword } from '@/lib/services/auth';

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(10).max(128),
  })
  .strict();

export async function PATCH(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const body = passwordSchema.parse(await req.json());
    const user = await getDb().user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (!(await verifyPassword(user.passwordHash, body.currentPassword))) {
      return apiError('CURRENT_PASSWORD_INVALID', 'Current password is incorrect.', 400);
    }
    await setPassword(user.id, body.newPassword);
    const cookieHeader = req.headers.get('cookie') ?? '';
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
    await invalidateOtherSessions(user.id, match?.[1]);
    await logAudit({
      userId: user.id,
      action: 'user.password_change',
      targetType: 'user',
      targetId: user.id,
    });
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleRouteError(e);
  }
}
