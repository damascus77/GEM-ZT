import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let storedValue: string | undefined;

vi.mock('@/lib/db/client', () => ({
  getDb: () => ({
    setting: {
      findUnique: vi.fn(async () =>
        storedValue === undefined ? null : { key: 'admin.rate_limits', value: storedValue }
      ),
      upsert: vi.fn(async ({ create, update }) => {
        storedValue = update.value ?? create.value;
        return { key: 'admin.rate_limits', value: storedValue };
      }),
    },
  }),
}));

import {
  defaultRateLimitSettings,
  getLoginRateLimiters,
  getRateLimitSettings,
  resetRateLimitSettingsCache,
  setRateLimitSettings,
} from '@/lib/services/rateLimitSettings';

const OLD_ENV = process.env;

beforeEach(() => {
  vi.resetModules();
  storedValue = undefined;
  process.env = { ...OLD_ENV };
  delete process.env.GEMZT_LOGIN_MAX_ATTEMPTS;
  delete process.env.GEMZT_LOGIN_IP_MAX_ATTEMPTS;
  delete process.env.GEMZT_LOGIN_WINDOW_MS;
  delete process.env.GEMZT_SELF_AUTHORIZE_MAX_ATTEMPTS;
  delete process.env.GEMZT_SELF_AUTHORIZE_WINDOW_MS;
  resetRateLimitSettingsCache();
});

afterEach(() => {
  process.env = OLD_ENV;
  resetRateLimitSettingsCache();
});

describe('rate-limit settings service', () => {
  it('returns env-backed defaults when no override is saved', () => {
    process.env.GEMZT_LOGIN_MAX_ATTEMPTS = '7';
    process.env.GEMZT_LOGIN_IP_MAX_ATTEMPTS = '30';
    process.env.GEMZT_LOGIN_WINDOW_MS = '120000';
    process.env.GEMZT_SELF_AUTHORIZE_MAX_ATTEMPTS = '11';
    process.env.GEMZT_SELF_AUTHORIZE_WINDOW_MS = '60000';

    expect(defaultRateLimitSettings()).toEqual({
      loginMaxAttempts: 7,
      loginIpMaxAttempts: 30,
      loginWindowMs: 120000,
      selfAuthorizeMaxAttempts: 11,
      selfAuthorizeWindowMs: 60000,
    });
  });

  it('persists overrides and returns them as effective settings', async () => {
    const saved = await setRateLimitSettings({
      loginMaxAttempts: 2,
      loginIpMaxAttempts: 3,
      loginWindowMs: 4000,
      selfAuthorizeMaxAttempts: 4,
      selfAuthorizeWindowMs: 5000,
    });

    expect(saved.effective.loginMaxAttempts).toBe(2);
    resetRateLimitSettingsCache();
    await expect(getRateLimitSettings()).resolves.toMatchObject({
      effective: { loginIpMaxAttempts: 3, selfAuthorizeWindowMs: 5000 },
    });
  });

  it('rejects non-positive attempts and sub-second windows', async () => {
    await expect(
      setRateLimitSettings({
        loginMaxAttempts: 0,
        loginIpMaxAttempts: 3,
        loginWindowMs: 4000,
        selfAuthorizeMaxAttempts: 4,
        selfAuthorizeWindowMs: 5000,
      })
    ).rejects.toThrow(/positive integer/i);

    await expect(
      setRateLimitSettings({
        loginMaxAttempts: 2,
        loginIpMaxAttempts: 3,
        loginWindowMs: 999,
        selfAuthorizeMaxAttempts: 4,
        selfAuthorizeWindowMs: 5000,
      })
    ).rejects.toThrow(/integer >= 1000/i);
  });

  it('rebuilds login limiter instances after saved settings change', async () => {
    await setRateLimitSettings({
      loginMaxAttempts: 1,
      loginIpMaxAttempts: 3,
      loginWindowMs: 4000,
      selfAuthorizeMaxAttempts: 4,
      selfAuthorizeWindowMs: 5000,
    });
    const first = await getLoginRateLimiters();

    await setRateLimitSettings({
      loginMaxAttempts: 2,
      loginIpMaxAttempts: 3,
      loginWindowMs: 4000,
      selfAuthorizeMaxAttempts: 4,
      selfAuthorizeWindowMs: 5000,
    });
    const second = await getLoginRateLimiters();

    expect(second.username).not.toBe(first.username);
  });
});
