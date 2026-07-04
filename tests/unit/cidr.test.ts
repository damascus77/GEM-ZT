import { describe, it, expect } from 'vitest';
import { isValidCidr, cidrToPool } from '@/lib/util/cidr';

describe('isValidCidr', () => {
  it('accepts valid IPv4 CIDRs', () => {
    expect(isValidCidr('10.147.17.0/24')).toBe(true);
    expect(isValidCidr('192.168.0.0/16')).toBe(true);
    expect(isValidCidr('0.0.0.0/0')).toBe(true);
  });

  it('accepts valid IPv6 CIDRs', () => {
    expect(isValidCidr('fd00::/8')).toBe(true);
    expect(isValidCidr('2001:db8::/32')).toBe(true);
  });

  it('rejects garbage', () => {
    expect(isValidCidr('10.147.17.0')).toBe(false);
    expect(isValidCidr('10.147.17.0/33')).toBe(false);
    expect(isValidCidr('300.1.1.1/24')).toBe(false);
    expect(isValidCidr('fd00::/129')).toBe(false);
    expect(isValidCidr('banana/24')).toBe(false);
  });

  it('rejects structurally invalid IPv6 (too many groups, double ::, all-empty)', () => {
    expect(isValidCidr('1:2:3:4:5:6:7:8:9/64')).toBe(false); // 9 groups
    expect(isValidCidr('1::2::3/64')).toBe(false); // two compressions
    expect(isValidCidr(':::::/64')).toBe(false); // all-empty
    expect(isValidCidr('gggg::/64')).toBe(false); // non-hex
    expect(isValidCidr('fd00::1/64')).toBe(true); // sanity: still accepts valid
  });
});

describe('cidrToPool', () => {
  it('converts a /24 to a usable start/end range', () => {
    expect(cidrToPool('10.147.17.0/24')).toEqual({
      ipRangeStart: '10.147.17.1',
      ipRangeEnd: '10.147.17.254',
    });
  });

  it('converts a /16', () => {
    expect(cidrToPool('10.10.0.0/16')).toEqual({
      ipRangeStart: '10.10.0.1',
      ipRangeEnd: '10.10.255.254',
    });
  });

  it('handles /31 and /32 without offsets', () => {
    expect(cidrToPool('10.0.0.0/31')).toEqual({
      ipRangeStart: '10.0.0.0',
      ipRangeEnd: '10.0.0.1',
    });
    expect(cidrToPool('10.0.0.5/32')).toEqual({
      ipRangeStart: '10.0.0.5',
      ipRangeEnd: '10.0.0.5',
    });
  });

  it('throws on invalid or IPv6 input', () => {
    expect(() => cidrToPool('fd00::/64')).toThrow('Invalid IPv4 CIDR');
    expect(() => cidrToPool('nope')).toThrow('Invalid IPv4 CIDR');
  });
});
