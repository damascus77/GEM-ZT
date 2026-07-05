import type { ApiKey, Session, User } from '@prisma/client';
import { apiError } from './errors';
import { getSession, SESSION_COOKIE } from '@/lib/services/auth';
import { verifyApiKeyWithRecord } from '@/lib/services/apiKeys';

export type ResolvedAuth =
  | { user: User; via: 'session'; session: Session }
  | { user: User; via: 'apikey'; apiKey: ApiKey }
  | null;

/**
 * Parse the Authorization bearer token (ztk_…) or the session cookie off `req`
 * and resolve it to the authenticated user, tagged with how it was resolved
 * (`session` vs `apikey`) plus the underlying record. `requireAuth` below
 * delegates here and only exposes `{ user }` for existing callers.
 */
export async function resolveAuth(req: Request): Promise<ResolvedAuth> {
  const authz = req.headers.get('authorization');
  // RFC 7235: the auth scheme is case-insensitive ("Bearer"/"bearer"). The token
  // itself (ztk_…) stays case-sensitive.
  const bearer = authz?.match(/^Bearer[ \t]+(.+)$/i);
  if (bearer && bearer[1].startsWith('ztk_')) {
    const result = await verifyApiKeyWithRecord(bearer[1]);
    if (result) return { user: result.user, via: 'apikey', apiKey: result.apiKey };
    return null;
  }
  const cookieHeader = req.headers.get('cookie') ?? '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (match) {
    const session = await getSession(match[1]);
    if (session) {
      const { user, ...rest } = session;
      return { user, via: 'session', session: rest as Session };
    }
  }
  return null;
}

export async function requireAuth(req: Request): Promise<{ user: User } | Response> {
  const authz = req.headers.get('authorization');
  const bearer = authz?.match(/^Bearer[ \t]+(.+)$/i);
  const auth = await resolveAuth(req);
  if (auth) return { user: auth.user };
  if (bearer && bearer[1].startsWith('ztk_')) {
    return apiError('UNAUTHORIZED', 'Invalid or expired API key.', 401);
  }
  return apiError('UNAUTHORIZED', 'Authentication required.', 401);
}
