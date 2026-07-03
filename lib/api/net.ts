/**
 * Best-effort client IP extraction from proxy headers. Trusts the standard
 * reverse-proxy conventions (nginx/traefik/etc set x-forwarded-for or
 * x-real-ip); falls back to 'unknown' when neither is present (e.g. direct
 * connections in dev/test).
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const xRealIp = req.headers.get('x-real-ip');
  if (xRealIp) return xRealIp.trim();
  return 'unknown';
}
