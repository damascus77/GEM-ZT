import { isIP } from 'node:net';

/**
 * SSRF guard for operator-supplied outbound URLs (currently the new-member
 * webhook). The app runs as the network admin panel co-located with the
 * ZeroTier controller, so a server-side fetch to an attacker-chosen URL is a
 * real internal-network / cloud-metadata risk.
 *
 * Scope: this blocks the http(s)-scheme + literal private/loopback/link-local
 * address cases (e.g. http://169.254.169.254/…, http://localhost:9993/…) and,
 * combined with `redirect: 'error'` at the fetch call site, redirect-based
 * pivots. It does NOT resolve DNS, so a public hostname that resolves to a
 * private address (DNS rebinding) is not caught here — acceptable given the
 * authenticated single-admin deployment, but noted so it isn't mistaken for
 * complete SSRF protection.
 */
export class WebhookUrlError extends Error {
  readonly code = 'WEBHOOK_URL_INVALID';
}

function ipv4Octets(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const octets = m.slice(1, 5).map(Number);
  return octets.some(o => o > 255) ? null : octets;
}

function isPrivateIpv4(ip: string): boolean {
  const o = ipv4Octets(ip);
  if (!o) return false;
  const [a, b] = o;
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata 169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  return false;
}

/** True for loopback / private / link-local / unspecified IPv4 or IPv6 literals. */
export function isPrivateIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateIpv4(ip);
  if (kind === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true; // loopback / unspecified
    const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower);
    if (mapped) return isPrivateIpv4(mapped[1]); // IPv4-mapped ::ffff:a.b.c.d
    const head = lower.split(':')[0];
    if (/^f[cd]/.test(head)) return true; // fc00::/7 unique-local
    if (/^fe[89ab]/.test(head)) return true; // fe80::/10 link-local
    return false;
  }
  return false;
}

/**
 * Parse and validate an outbound webhook URL. Throws WebhookUrlError if the
 * scheme isn't http(s) or the host is an internal name / private-IP literal.
 */
export function assertSafeWebhookUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebhookUrlError('Webhook URL is not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebhookUrlError('Webhook URL must use http or https.');
  }
  // URL.hostname keeps IPv6 literals bracketed; strip for the IP check.
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === '' ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new WebhookUrlError('Webhook URL host is not allowed.');
  }
  if (isIP(host) && isPrivateIp(host)) {
    throw new WebhookUrlError('Webhook URL points to a private, loopback, or link-local address.');
  }
  return url;
}

/** Boolean form of assertSafeWebhookUrl, for use in zod refinements. */
export function isSafeWebhookUrl(raw: string): boolean {
  try {
    assertSafeWebhookUrl(raw);
    return true;
  } catch {
    return false;
  }
}
