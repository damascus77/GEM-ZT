import type { User } from '@prisma/client';
import { apiError } from './errors';
import { getSession, SESSION_COOKIE } from '@/lib/services/auth';
import { verifyApiKey } from '@/lib/services/apiKeys';

export async function requireAuth(req: Request): Promise<{ user: User } | Response> {
  const authz = req.headers.get('authorization');
  // RFC 7235: the auth scheme is case-insensitive ("Bearer"/"bearer"). The token
  // itself (ztk_…) stays case-sensitive.
  const bearer = authz?.match(/^Bearer[ \t]+(.+)$/i);
  if (bearer && bearer[1].startsWith('ztk_')) {
    const user = await verifyApiKey(bearer[1]);
    if (user) return { user };
    return apiError('UNAUTHORIZED', 'Invalid or expired API key.', 401);
  }
  const cookieHeader = req.headers.get('cookie') ?? '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (match) {
    const session = await getSession(match[1]);
    if (session) return { user: session.user };
  }
  return apiError('UNAUTHORIZED', 'Authentication required.', 401);
}
