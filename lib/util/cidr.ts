const IPV4_RE =
  /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\/(3[0-2]|[12]?\d)$/;
const IPV6_RE = /^[0-9a-fA-F:]+\/(12[0-8]|1[01]\d|\d{1,2})$/;

export function isValidCidr(cidr: string): boolean {
  if (IPV4_RE.test(cidr)) return true;
  if (!IPV6_RE.test(cidr)) return false;
  const addr = cidr.split('/')[0];
  // require at least one ':' and only valid groups
  if (!addr.includes(':')) return false;
  const groups = addr.split(':');
  return groups.every((g) => g === '' || /^[0-9a-fA-F]{1,4}$/.test(g));
}

function ipv4ToInt(ip: string): number {
  return ip
    .split('.')
    .reduce((acc, octet) => acc * 256 + Number(octet), 0);
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
