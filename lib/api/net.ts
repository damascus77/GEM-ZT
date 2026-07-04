/**
 * Best-effort client IP extraction from proxy headers, used only for rate-limit
 * keying. x-forwarded-for / x-real-ip are attacker-controlled unless a trusted
 * reverse proxy overwrites them, so an attacker on a directly-exposed instance
 * could rotate the header per request to evade the per-IP login limiter.
 *
 * Trust is gated by GEMZT_TRUST_PROXY. It defaults to true because the
 * documented deployment runs behind the compose network / a reverse proxy that
 * sets these headers; operators exposing the app directly (no trusted proxy)
 * should set GEMZT_TRUST_PROXY=false, which makes this return 'unknown' so the
 * per-IP limiter can't be bypassed with spoofed headers. Read per-call so it's
 * configurable and testable at runtime.
 */
export function clientIp(req: Request): string {
  const trustProxy = (process.env.GEMZT_TRUST_PROXY ?? 'true').toLowerCase() !== 'false';
  if (trustProxy) {
    const xff = req.headers.get('x-forwarded-for');
    if (xff) {
      const first = xff.split(',')[0]?.trim();
      if (first) return first;
    }
    const xRealIp = req.headers.get('x-real-ip');
    if (xRealIp) return xRealIp.trim();
  }
  return 'unknown';
}
