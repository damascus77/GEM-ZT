import type { User } from '@prisma/client';
import { apiError } from './errors';
import { getSession, SESSION_COOKIE } from '@/lib/services/auth';
import { verifyApiKey } from '@/lib/services/apiKeys';

export async function requireAuth(req: Request): Promise<{ user: User } | Response> {
  const authz = req.headers.get('authorization');
  if (authz && authz.startsWith('Bearer ztk_')) {
    const user = await verifyApiKey(authz.slice('Bearer '.length));
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
