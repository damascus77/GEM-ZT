import { NextResponse } from 'next/server';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { clientIp } from '@/lib/api/net';
import { createRateLimiter } from '@/lib/services/rateLimit';
import { getInvitationRowByToken } from '@/lib/services/invitations';

type Ctx = { params: Promise<{ token: string }> };

// Public, unauthenticated route — rate-limit by IP so it can't be used to mass-
// probe for valid invitation tokens (mirrors /setup's limiter).
const PREVIEW_MAX_ATTEMPTS = Number(process.env.GEMZT_INVITE_PREVIEW_MAX_ATTEMPTS ?? 30);
const PREVIEW_WINDOW_MS = Number(process.env.GEMZT_INVITE_PREVIEW_WINDOW_MS ?? 15 * 60 * 1000);
const previewLimiter = createRateLimiter({
  limit: PREVIEW_MAX_ATTEMPTS,
  windowMs: PREVIEW_WINDOW_MS,
});

export async function GET(req: Request, { params }: Ctx) {
  try {
    const ipKey = clientIp(req);
    const gate = previewLimiter.check(ipKey);
    if (!gate.allowed) {
      return apiError('RATE_LIMITED', 'Too many requests. Try again later.', 429, {
        'Retry-After': String(Math.ceil(gate.retryAfterMs / 1000)),
      });
    }
    const { token } = await params;
    const row = await getInvitationRowByToken(token);
    if (!row) {
      previewLimiter.recordFailure(ipKey);
      return apiError('NOT_FOUND', 'Invitation not found.', 404);
    }
    if (row.acceptedAt) {
      previewLimiter.recordFailure(ipKey);
      return apiError('INVITATION_USED', 'This invitation has already been used.', 409);
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      previewLimiter.recordFailure(ipKey);
      return apiError('INVITATION_EXPIRED', 'This invitation has expired.', 410);
    }
    return NextResponse.json({ org: { name: row.org.name }, role: row.role });
  } catch (e) {
    return handleRouteError(e);
  }
}
