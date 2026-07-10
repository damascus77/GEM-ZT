import { isValidCidr, ipv4CidrRange, ipv4ToIntChecked } from './cidr';

export interface RouteInput {
  target: string;
  via: string | null;
}

export interface PoolInput {
  ipRangeStart: string;
  ipRangeEnd: string;
}

/**
 * Pre-save sanity warnings for a network's routes and IP pools. These are
 * advisory (the classic "saved a broken route, network silently dead" traps),
 * not hard errors. IPv4-only for the overlap/containment maths; IPv6 targets are
 * only format-checked.
 */
export function validateRoutesAndPools(input: {
  routes: RouteInput[];
  pools: PoolInput[];
}): string[] {
  const warnings: string[] = [];
  const { routes, pools } = input;

  for (const r of routes) {
    if (r.target.trim() !== '' && !isValidCidr(r.target)) {
      warnings.push(`Route "${r.target}" is not a valid CIDR.`);
    }
  }

  // Overlapping IPv4 route targets.
  const v4 = routes
    .map(r => ({ target: r.target, range: ipv4CidrRange(r.target) }))
    .filter((r): r is { target: string; range: [number, number] } => r.range !== null);
  for (let i = 0; i < v4.length; i++) {
    for (let j = i + 1; j < v4.length; j++) {
      const [a1, a2] = v4[i].range;
      const [b1, b2] = v4[j].range;
      if (a1 <= b2 && b1 <= a2) {
        warnings.push(`Routes "${v4[i].target}" and "${v4[j].target}" overlap.`);
      }
    }
  }

  // `via` gateways should sit inside a managed route (otherwise unreachable).
  for (const r of routes) {
    if (!r.via) continue;
    const via = ipv4ToIntChecked(r.via);
    if (via === null) {
      warnings.push(`Gateway "${r.via}" for route "${r.target}" is not a valid IPv4 address.`);
      continue;
    }
    const inside = v4.some(({ range: [lo, hi] }) => via >= lo && via <= hi);
    if (!inside) {
      warnings.push(`Gateway "${r.via}" is not inside any managed route.`);
    }
  }

  // Pools should fall within a managed route. IPv6 pools are format-checked
  // only (see file-level comment) — skip the IPv4 containment math for them
  // rather than misreporting them as malformed.
  for (const p of pools) {
    const startIsV6 = looksLikeIpv6(p.ipRangeStart);
    const endIsV6 = looksLikeIpv6(p.ipRangeEnd);
    if (startIsV6 || endIsV6) {
      if (!startIsV6 || !endIsV6) {
        warnings.push(`Pool ${p.ipRangeStart}–${p.ipRangeEnd} mixes address families.`);
      }
      continue;
    }
    const start = ipv4ToIntChecked(p.ipRangeStart);
    const end = ipv4ToIntChecked(p.ipRangeEnd);
    if (start === null || end === null) {
      warnings.push(`Pool ${p.ipRangeStart}–${p.ipRangeEnd} has a malformed address.`);
      continue;
    }
    const covered = v4.some(({ range: [lo, hi] }) => start >= lo && end <= hi);
    if (!covered) {
      warnings.push(`Pool ${p.ipRangeStart}–${p.ipRangeEnd} is outside every managed route.`);
    }
  }

  return warnings;
}

const IPV4_ADDR_RE = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

// Loose IPv6 recognizer: hex groups and colons only, at least one colon. Good
// enough for an advisory browser-side warning without a full RFC 4291 grammar.
function looksLikeIpv6(s: string): boolean {
  return s.includes(':') && /^[0-9a-fA-F:]+$/.test(s);
}

/** Warn about malformed DNS server addresses (IPv4 or IPv6). */
export function validateDnsServers(servers: string[]): string[] {
  return servers
    .filter(s => s.trim() !== '')
    .filter(s => !IPV4_ADDR_RE.test(s) && !looksLikeIpv6(s))
    .map(s => `DNS server "${s}" is not a valid IP address.`);
}
