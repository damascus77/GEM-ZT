import { describe, it, expect, afterEach } from 'vitest';
import { validateRateLimitEnv } from '@/lib/util/envValidation';

const VARS = [
  'GEMZT_LOGIN_IP_MAX_ATTEMPTS',
  'GEMZT_LOGIN_MAX_ATTEMPTS',
  'GEMZT_LOGIN_WINDOW_MS',
  'GEMZT_AUDIT_RETENTION_DAYS',
  'GEMZT_TRUST_PROXY',
] as const;

afterEach(() => {
  for (const key of VARS) delete process.env[key];
});

describe('validateRateLimitEnv', () => {
  it('passes when no env vars are set', () => {
    expect(() => validateRateLimitEnv()).not.toThrow();
  });

  describe('GEMZT_LOGIN_IP_MAX_ATTEMPTS', () => {
    it('passes for a valid positive integer', () => {
      process.env.GEMZT_LOGIN_IP_MAX_ATTEMPTS = '5';
      expect(() => validateRateLimitEnv()).not.toThrow();
    });
    it('throws for a non-integer', () => {
      process.env.GEMZT_LOGIN_IP_MAX_ATTEMPTS = '1.5';
      expect(() => validateRateLimitEnv()).toThrow('GEMZT_LOGIN_IP_MAX_ATTEMPTS');
    });
    it('throws for zero', () => {
      process.env.GEMZT_LOGIN_IP_MAX_ATTEMPTS = '0';
      expect(() => validateRateLimitEnv()).toThrow('GEMZT_LOGIN_IP_MAX_ATTEMPTS');
    });
    it('throws for a non-numeric string', () => {
      process.env.GEMZT_LOGIN_IP_MAX_ATTEMPTS = 'foo';
      expect(() => validateRateLimitEnv()).toThrow('GEMZT_LOGIN_IP_MAX_ATTEMPTS');
    });
  });

  describe('GEMZT_LOGIN_MAX_ATTEMPTS', () => {
    it('passes for a valid positive integer', () => {
      process.env.GEMZT_LOGIN_MAX_ATTEMPTS = '10';
      expect(() => validateRateLimitEnv()).not.toThrow();
    });
    it('throws for a negative value', () => {
      process.env.GEMZT_LOGIN_MAX_ATTEMPTS = '-1';
      expect(() => validateRateLimitEnv()).toThrow('GEMZT_LOGIN_MAX_ATTEMPTS');
    });
    it('throws for a non-numeric string', () => {
      process.env.GEMZT_LOGIN_MAX_ATTEMPTS = 'ten';
      expect(() => validateRateLimitEnv()).toThrow('GEMZT_LOGIN_MAX_ATTEMPTS');
    });
  });

  describe('GEMZT_LOGIN_WINDOW_MS', () => {
    it('passes for a value >= 1000', () => {
      process.env.GEMZT_LOGIN_WINDOW_MS = '60000';
      expect(() => validateRateLimitEnv()).not.toThrow();
    });
    it('passes for exactly 1000', () => {
      process.env.GEMZT_LOGIN_WINDOW_MS = '1000';
      expect(() => validateRateLimitEnv()).not.toThrow();
    });
    it('throws for a value below 1000', () => {
      process.env.GEMZT_LOGIN_WINDOW_MS = '999';
      expect(() => validateRateLimitEnv()).toThrow('GEMZT_LOGIN_WINDOW_MS');
    });
    it('throws for a non-integer', () => {
      process.env.GEMZT_LOGIN_WINDOW_MS = '1000.5';
      expect(() => validateRateLimitEnv()).toThrow('GEMZT_LOGIN_WINDOW_MS');
    });
  });

  describe('GEMZT_AUDIT_RETENTION_DAYS', () => {
    it('passes for a valid positive integer', () => {
      process.env.GEMZT_AUDIT_RETENTION_DAYS = '30';
      expect(() => validateRateLimitEnv()).not.toThrow();
    });
    it('throws for zero', () => {
      process.env.GEMZT_AUDIT_RETENTION_DAYS = '0';
      expect(() => validateRateLimitEnv()).toThrow('GEMZT_AUDIT_RETENTION_DAYS');
    });
    it('throws for a non-numeric string', () => {
      process.env.GEMZT_AUDIT_RETENTION_DAYS = 'never';
      expect(() => validateRateLimitEnv()).toThrow('GEMZT_AUDIT_RETENTION_DAYS');
    });
  });

  describe('GEMZT_TRUST_PROXY', () => {
    it('passes for "true"', () => {
      process.env.GEMZT_TRUST_PROXY = 'true';
      expect(() => validateRateLimitEnv()).not.toThrow();
    });
    it('passes for "false"', () => {
      process.env.GEMZT_TRUST_PROXY = 'false';
      expect(() => validateRateLimitEnv()).not.toThrow();
    });
    it('passes for "TRUE" (case-insensitive)', () => {
      process.env.GEMZT_TRUST_PROXY = 'TRUE';
      expect(() => validateRateLimitEnv()).not.toThrow();
    });
    it('throws for "yes"', () => {
      process.env.GEMZT_TRUST_PROXY = 'yes';
      expect(() => validateRateLimitEnv()).toThrow('GEMZT_TRUST_PROXY');
    });
    it('throws for "1"', () => {
      process.env.GEMZT_TRUST_PROXY = '1';
      expect(() => validateRateLimitEnv()).toThrow('GEMZT_TRUST_PROXY');
    });
    it('throws for an arbitrary string', () => {
      process.env.GEMZT_TRUST_PROXY = 'enabled';
      expect(() => validateRateLimitEnv()).toThrow('GEMZT_TRUST_PROXY');
    });
  });
});
