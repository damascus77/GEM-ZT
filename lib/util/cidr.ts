const IPV4_RE =
  /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\/(3[0-2]|[12]?\d)$/;
const IPV6_PREFIX_RE = /^(12[0-8]|1[01]\d|\d{1,2})$/; // 0..128

/**
 * Structural IPv6 validation. A pure implementation (no node:net) because this
 * module is also imported by client components (RoutesEditor → cidrToPool), and
 * bundling a `node:` builtin for the browser breaks the Next.js build. Rejects
 * >8 groups, multiple '::', non-hex/over-long groups, and stray colons —
 * exactly the structurally-invalid inputs the old check let through.
 */
function isIpv6(addr: string): boolean {
  const parseGroups = (str: string): string[] | null => {
    if (str === '') return [];
    const groups = str.split(':');
    return groups.every(g => /^[0-9a-fA-F]{1,4}$/.test(g)) ? groups : null;
  };
  const parts = addr.split('::');
  if (parts.length > 2) return false; // more than one '::'
  if (parts.length === 2) {
    const left = parseGroups(parts[0]);
    const right = parseGroups(parts[1]);
    // '::' stands for >=1 all-zero group, so the explicit groups must total < 8.
    return left !== null && right !== null && left.length + right.length <= 7;
  }
  const groups = parseGroups(addr);
  return groups !== null && groups.length === 8;
}

export function isValidCidr(cidr: string): boolean {
  if (IPV4_RE.test(cidr)) return true;
  // Split on the LAST '/' so the address (which contains ':') isn't mangled.
  const slash = cidr.lastIndexOf('/');
  if (slash === -1) return false;
  const addr = cidr.slice(0, slash);
  const prefix = cidr.slice(slash + 1);
  if (!IPV6_PREFIX_RE.test(prefix)) return false;
  return isIpv6(addr);
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => acc * 256 + Number(octet), 0);
}

const IPV4_ADDR_RE = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/** Parse a dotted-quad IPv4 address to a uint32, or null if malformed. */
export function ipv4ToIntChecked(ip: string): number | null {
  return IPV4_ADDR_RE.test(ip) ? ipv4ToInt(ip) >>> 0 : null;
}

/** True for a bare IP address (no prefix), either IPv4 or IPv6. */
export function isValidIp(ip: string): boolean {
  return ipv4ToIntChecked(ip) !== null || isIpv6(ip);
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
  return [24, 16, 8, 0].map(shift => (n >>> shift) & 0xff).join('.');
}

const IPV6_GROUP_COUNT = 8;
const IPV6_BITS = 128n;
const IPV6_ALL_ONES = (1n << IPV6_BITS) - 1n;

/** Expand a (possibly '::'-compressed) IPv6 address into its 8 groups as bigints. */
function expandIpv6Groups(addr: string): bigint[] {
  const parseGroups = (s: string): bigint[] =>
    s === '' ? [] : s.split(':').map(g => BigInt(parseInt(g, 16)));
  const parts = addr.split('::');
  if (parts.length === 2) {
    const left = parseGroups(parts[0]);
    const right = parseGroups(parts[1]);
    const middle = new Array(IPV6_GROUP_COUNT - left.length - right.length).fill(0n);
    return [...left, ...middle, ...right];
  }
  return parseGroups(addr);
}

function ipv6ToBigInt(addr: string): bigint {
  return expandIpv6Groups(addr).reduce((acc, g) => (acc << 16n) | g, 0n);
}

/** Render a 128-bit value back to IPv6 text, compressing the longest run of zero groups. */
function bigIntToIpv6(n: bigint): string {
  const groups: string[] = [];
  for (let shift = 112n; shift >= 0n; shift -= 16n) {
    groups.push(((n >> shift) & 0xffffn).toString(16));
  }
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < groups.length; i++) {
    if (groups[i] === '0') {
      if (curStart === -1) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }
  if (bestLen > 1) {
    const head = groups.slice(0, bestStart);
    const tail = groups.slice(bestStart + bestLen);
    return `${head.join(':')}::${tail.join(':')}`;
  }
  return groups.join(':');
}

/**
 * First/last address of an IPv6 CIDR block. Unlike the IPv4 path below, no
 * addresses are excluded at the edges — IPv6 has no "network"/"broadcast"
 * address convention, so a /127 or /128 legitimately uses every address in
 * its range.
 */
function cidrToPoolV6(cidr: string): { ipRangeStart: string; ipRangeEnd: string } {
  const slash = cidr.lastIndexOf('/');
  const addr = cidr.slice(0, slash);
  const prefix = Number(cidr.slice(slash + 1));
  const base = ipv6ToBigInt(addr);
  const hostBits = IPV6_BITS - BigInt(prefix);
  const mask = (IPV6_ALL_ONES << hostBits) & IPV6_ALL_ONES;
  const network = base & mask;
  const broadcast = network | (~mask & IPV6_ALL_ONES);
  return { ipRangeStart: bigIntToIpv6(network), ipRangeEnd: bigIntToIpv6(broadcast) };
}

export function cidrToPool(cidr: string): { ipRangeStart: string; ipRangeEnd: string } {
  if (IPV4_RE.test(cidr)) {
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
  if (isValidCidr(cidr)) {
    return cidrToPoolV6(cidr);
  }
  throw new Error(`Invalid CIDR: ${cidr}`);
}
