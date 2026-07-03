import { handleRouteError } from '@/lib/api/errors';
import { logout, SESSION_COOKIE, clearSessionCookieHeader } from '@/lib/services/auth';

export async function POST(req: Request) {
  try {
    const cookieHeader = req.headers.get('cookie') ?? '';
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
    if (match) {
      await logout(match[1]);
    }
    return new Response(null, {
      status: 204,
      headers: { 'Set-Cookie': clearSessionCookieHeader() },
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
