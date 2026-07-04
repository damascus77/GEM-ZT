import { isIP } from 'node:net';

const IPV4_RE =
  /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\/(3[0-2]|[12]?\d)$/;
const IPV6_PREFIX_RE = /^(12[0-8]|1[01]\d|\d{1,2})$/; // 0..128

export function isValidCidr(cidr: string): boolean {
  if (IPV4_RE.test(cidr)) return true;
  // IPv6: the old hand-rolled group check accepted structurally invalid
  // addresses (>8 groups, multiple '::', all-empty). Delegate to node's inet
  // validator, which rejects those. Split on the LAST '/' so the address (which
  // contains ':') isn't mangled.
  const slash = cidr.lastIndexOf('/');
  if (slash === -1) return false;
  const addr = cidr.slice(0, slash);
  const prefix = cidr.slice(slash + 1);
  if (!IPV6_PREFIX_RE.test(prefix)) return false;
  return isIP(addr) === 6;
}

function ipv4ToInt(ip: string): number {
  return ip
    .split('.')
    .reduce((acc, octet) => acc * 256 + Number(octet), 0);
}

const IPV4_ADDR_RE = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/** Parse a dotted-quad IPv4 address to a uint32, or null if malformed. */
export function ipv4ToIntChecked(ip: string): number | null {
  return IPV4_ADDR_RE.test(ip) ? ipv4ToInt(ip) >>> 0 : null;
}

/** Inclusive [network, broadcast] uint32 range of an IPv4 CIDR, or null if not IPv4. */
export function ipv4CidrRange(cidr: string): [number, number] | null {
  if (!IPV4_RE.test(cidr)) return null;
  const [addr, prefixStr] = cidr.split('/');
  const prefix = Number(prefixStr);
  const base = ipv4ToInt(addr) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (base & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  return [network, broadcast];
}

function intToIpv4(n: number): string {
  return [24, 16, 8, 0].map((shift) => (n >>> shift) & 0xff).join('.');
}

export function cidrToPool(cidr: string): { ipRangeStart: string; ipRangeEnd: string } {
  if (!IPV4_RE.test(cidr)) {
    throw new Error(`Invalid IPv4 CIDR: ${cidr}`);
  }
  const [addr, prefixStr] = cidr.split('/');
  const prefix = Number(prefixStr);
  const base = ipv4ToInt(addr);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (base & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  if (prefix >= 31) {
    return { ipRangeStart: intToIpv4(network), ipRangeEnd: intToIpv4(broadcast) };
  }
  return { ipRangeStart: intToIpv4(network + 1), ipRangeEnd: intToIpv4(broadcast - 1) };
}
