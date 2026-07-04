import { describe, it, expect } from 'vitest';
import { validateRoutesAndPools, validateDnsServers } from '@/lib/util/networkValidation';

describe('validateRoutesAndPools', () => {
  it('flags overlapping route targets', () => {
    const w = validateRoutesAndPools({
      routes: [
        { target: '10.0.0.0/16', via: null },
        { target: '10.0.1.0/24', via: null },
      ],
      pools: [],
    });
    expect(w.some((m) => /overlap/i.test(m))).toBe(true);
  });

  it('flags a pool that falls outside every managed route', () => {
    const w = validateRoutesAndPools({
      routes: [{ target: '10.0.0.0/16', via: null }],
      pools: [{ ipRangeStart: '192.168.1.10', ipRangeEnd: '192.168.1.20' }],
    });
    expect(w.some((m) => /pool/i.test(m))).toBe(true);
  });

  it('flags a via gateway that is not inside any managed route', () => {
    const w = validateRoutesAndPools({
      routes: [{ target: '10.0.0.0/16', via: '192.168.0.1' }],
      pools: [],
    });
    expect(w.some((m) => /via|gateway/i.test(m))).toBe(true);
  });

  it('flags a malformed route target', () => {
    const w = validateRoutesAndPools({ routes: [{ target: 'banana', via: null }], pools: [] });
    expect(w.some((m) => /valid|cidr/i.test(m))).toBe(true);
  });

  it('returns no warnings for a clean, consistent config', () => {
    const w = validateRoutesAndPools({
      routes: [{ target: '10.147.17.0/24', via: null }],
      pools: [{ ipRangeStart: '10.147.17.1', ipRangeEnd: '10.147.17.254' }],
    });
    expect(w).toEqual([]);
  });

  it('does not flag a well-formed IPv6 pool as malformed', () => {
    const w = validateRoutesAndPools({
      routes: [],
      pools: [{ ipRangeStart: 'fd00::', ipRangeEnd: 'fd00::ffff' }],
    });
    expect(w.some((m) => /malformed/i.test(m))).toBe(false);
  });

  it('still flags a pool that is neither valid IPv4 nor IPv6-shaped', () => {
    const w = validateRoutesAndPools({
      routes: [],
      pools: [{ ipRangeStart: 'not-an-address', ipRangeEnd: 'also-not-one' }],
    });
    expect(w.some((m) => /malformed/i.test(m))).toBe(true);
  });

  it('flags a pool that mixes address families', () => {
    const w = validateRoutesAndPools({
      routes: [],
      pools: [{ ipRangeStart: 'fd00::', ipRangeEnd: '10.0.0.1' }],
    });
    expect(w.some((m) => /mixes address families/i.test(m))).toBe(true);
  });
});

describe('validateDnsServers', () => {
  it('flags a malformed server address', () => {
    expect(validateDnsServers(['1.1.1.1', 'not-an-ip']).some((m) => /not-an-ip/.test(m))).toBe(true);
  });

  it('accepts valid IPv4 and IPv6 servers', () => {
    expect(validateDnsServers(['1.1.1.1', '2606:4700:4700::1111'])).toEqual([]);
  });
});
