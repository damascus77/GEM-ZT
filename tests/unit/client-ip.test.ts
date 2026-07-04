import { describe, it, expect, afterEach } from 'vitest';
import { clientIp } from '@/lib/api/net';

function reqWithHeaders(headers: Record<string, string>): Request {
  return new Request('http://x/api/v1/auth/login', { headers });
}

afterEach(() => {
  delete process.env.GEMZT_TRUST_PROXY;
});

describe('clientIp', () => {
  it('prefers the first entry of x-forwarded-for, trimmed', () => {
    const req = reqWithHeaders({ 'x-forwarded-for': ' 203.0.113.5 , 10.0.0.1' });
    expect(clientIp(req)).toBe('203.0.113.5');
  });

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    const req = reqWithHeaders({ 'x-real-ip': '198.51.100.7' });
    expect(clientIp(req)).toBe('198.51.100.7');
  });

  it('falls back to "unknown" when neither header is present', () => {
    const req = reqWithHeaders({});
    expect(clientIp(req)).toBe('unknown');
  });

  it('ignores forwarded headers when GEMZT_TRUST_PROXY=false', () => {
    process.env.GEMZT_TRUST_PROXY = 'false';
    const req = reqWithHeaders({ 'x-forwarded-for': '203.0.113.5', 'x-real-ip': '198.51.100.7' });
    expect(clientIp(req)).toBe('unknown');
  });

  it('trusts forwarded headers when GEMZT_TRUST_PROXY=true', () => {
    process.env.GEMZT_TRUST_PROXY = 'true';
    const req = reqWithHeaders({ 'x-forwarded-for': '203.0.113.5' });
    expect(clientIp(req)).toBe('203.0.113.5');
  });
});
