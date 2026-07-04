import { describe, it, expect } from 'vitest';
import { isPrivateIp, isSafeWebhookUrl, assertSafeWebhookUrl, WebhookUrlError } from '@/lib/util/ssrf';

describe('isPrivateIp', () => {
  it('flags private/loopback/link-local IPv4', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254', // cloud metadata
      '0.0.0.0',
      '100.64.0.1',
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it('allows public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '203.0.113.5', '172.32.0.1', '192.169.0.1']) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it('flags loopback / ULA / link-local / mapped IPv6', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it('allows public IPv6', () => {
    expect(isPrivateIp('2606:4700:4700::1111')).toBe(false);
    expect(isPrivateIp('::ffff:8.8.8.8')).toBe(false);
  });
});

describe('assertSafeWebhookUrl / isSafeWebhookUrl', () => {
  it('accepts public http(s) URLs', () => {
    expect(isSafeWebhookUrl('https://example.com/hook')).toBe(true);
    expect(isSafeWebhookUrl('http://8.8.8.8/hook')).toBe(true);
  });

  it('rejects non-http(s) schemes', () => {
    for (const u of ['file:///etc/passwd', 'ftp://example.com', 'gopher://x']) {
      expect(isSafeWebhookUrl(u), u).toBe(false);
    }
  });

  it('rejects internal hostnames and private-IP literals (the SSRF cases)', () => {
    for (const u of [
      'http://localhost:9993/controller/network', // co-located controller
      'http://169.254.169.254/latest/meta-data/', // cloud metadata
      'http://127.0.0.1/',
      'http://10.0.0.5/hook',
      'http://[::1]:9993/',
      'http://box.local/',
      'https://svc.internal/hook',
    ]) {
      expect(isSafeWebhookUrl(u), u).toBe(false);
    }
  });

  it('throws WebhookUrlError with a code on rejection', () => {
    expect(() => assertSafeWebhookUrl('http://127.0.0.1/')).toThrow(WebhookUrlError);
    try {
      assertSafeWebhookUrl('not-a-url');
    } catch (e) {
      expect((e as WebhookUrlError).code).toBe('WEBHOOK_URL_INVALID');
    }
  });
});
