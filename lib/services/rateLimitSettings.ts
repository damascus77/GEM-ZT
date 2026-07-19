import { getDb } from '@/lib/db/client';
import { createRateLimiter, type RateLimiter } from './rateLimit';

export interface RateLimitSettings {
  loginMaxAttempts: number;
  loginIpMaxAttempts: number;
  loginWindowMs: number;
  selfAuthorizeMaxAttempts: number;
  selfAuthorizeWindowMs: number;
}

export interface RateLimitSettingsView {
  defaults: RateLimitSettings;
  effective: RateLimitSettings;
  overrides: Partial<RateLimitSettings>;
}

export interface LoginRateLimiters {
  username: RateLimiter;
  ip: RateLimiter;
}

const SETTING_KEY = 'admin.rate_limits';

export function defaultRateLimitSettings(): RateLimitSettings {
  return {
    loginMaxAttempts: intFromEnv('GEMZT_LOGIN_MAX_ATTEMPTS', 5),
    loginIpMaxAttempts: intFromEnv('GEMZT_LOGIN_IP_MAX_ATTEMPTS', 20),
    loginWindowMs: intFromEnv('GEMZT_LOGIN_WINDOW_MS', 15 * 60 * 1000),
    selfAuthorizeMaxAttempts: intFromEnv('GEMZT_SELF_AUTHORIZE_MAX_ATTEMPTS', 10),
    selfAuthorizeWindowMs: intFromEnv('GEMZT_SELF_AUTHORIZE_WINDOW_MS', 15 * 60 * 1000),
  };
}

let cachedView: RateLimitSettingsView | null = null;
let loginLimiters: { key: string; value: LoginRateLimiters } | null = null;
let selfAuthorizeLimiter: { key: string; value: RateLimiter } | null = null;

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function validateSettings(input: RateLimitSettings): RateLimitSettings {
  const attempts: Array<keyof RateLimitSettings> = [
    'loginMaxAttempts',
    'loginIpMaxAttempts',
    'selfAuthorizeMaxAttempts',
  ];
  for (const key of attempts) {
    if (!Number.isInteger(input[key]) || input[key] < 1) {
      throw new Error(`${key} must be a positive integer.`);
    }
  }
  const windows: Array<keyof RateLimitSettings> = ['loginWindowMs', 'selfAuthorizeWindowMs'];
  for (const key of windows) {
    if (!Number.isInteger(input[key]) || input[key] < 1000) {
      throw new Error(`${key} must be an integer >= 1000.`);
    }
  }
  return input;
}

function parseOverrides(value: string | undefined): Partial<RateLimitSettings> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Partial<RateLimitSettings>;
    return {
      ...(parsed.loginMaxAttempts !== undefined
        ? { loginMaxAttempts: Number(parsed.loginMaxAttempts) }
        : {}),
      ...(parsed.loginIpMaxAttempts !== undefined
        ? { loginIpMaxAttempts: Number(parsed.loginIpMaxAttempts) }
        : {}),
      ...(parsed.loginWindowMs !== undefined
        ? { loginWindowMs: Number(parsed.loginWindowMs) }
        : {}),
      ...(parsed.selfAuthorizeMaxAttempts !== undefined
        ? { selfAuthorizeMaxAttempts: Number(parsed.selfAuthorizeMaxAttempts) }
        : {}),
      ...(parsed.selfAuthorizeWindowMs !== undefined
        ? { selfAuthorizeWindowMs: Number(parsed.selfAuthorizeWindowMs) }
        : {}),
    };
  } catch {
    return {};
  }
}

export async function getRateLimitSettings(): Promise<RateLimitSettingsView> {
  if (cachedView) return cachedView;
  const defaults = defaultRateLimitSettings();
  const row = await getDb().setting.findUnique({ where: { key: SETTING_KEY } });
  const overrides = parseOverrides(row?.value);
  const effective = validateSettings({ ...defaults, ...overrides });
  cachedView = { defaults, overrides, effective };
  return cachedView;
}

export async function setRateLimitSettings(
  input: RateLimitSettings
): Promise<RateLimitSettingsView> {
  const defaults = defaultRateLimitSettings();
  const effective = validateSettings({
    loginMaxAttempts: Number(input.loginMaxAttempts),
    loginIpMaxAttempts: Number(input.loginIpMaxAttempts),
    loginWindowMs: Number(input.loginWindowMs),
    selfAuthorizeMaxAttempts: Number(input.selfAuthorizeMaxAttempts),
    selfAuthorizeWindowMs: Number(input.selfAuthorizeWindowMs),
  });
  await getDb().setting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: JSON.stringify(effective) },
    update: { value: JSON.stringify(effective) },
  });
  resetRateLimitSettingsCache();
  cachedView = { defaults, overrides: effective, effective };
  return cachedView;
}

export function resetRateLimitSettingsCache(): void {
  cachedView = null;
  loginLimiters = null;
  selfAuthorizeLimiter = null;
}

export async function getLoginRateLimiters(): Promise<LoginRateLimiters> {
  const { effective } = await getRateLimitSettings();
  const key = JSON.stringify({
    loginMaxAttempts: effective.loginMaxAttempts,
    loginIpMaxAttempts: effective.loginIpMaxAttempts,
    loginWindowMs: effective.loginWindowMs,
  });
  if (loginLimiters?.key === key) return loginLimiters.value;
  const value = {
    username: createRateLimiter({
      limit: effective.loginMaxAttempts,
      windowMs: effective.loginWindowMs,
    }),
    ip: createRateLimiter({
      limit: effective.loginIpMaxAttempts,
      windowMs: effective.loginWindowMs,
    }),
  };
  loginLimiters = { key, value };
  return value;
}

export async function getSelfAuthorizeRateLimiter(): Promise<RateLimiter> {
  const { effective } = await getRateLimitSettings();
  const key = JSON.stringify({
    selfAuthorizeMaxAttempts: effective.selfAuthorizeMaxAttempts,
    selfAuthorizeWindowMs: effective.selfAuthorizeWindowMs,
  });
  if (selfAuthorizeLimiter?.key === key) return selfAuthorizeLimiter.value;
  const value = createRateLimiter({
    limit: effective.selfAuthorizeMaxAttempts,
    windowMs: effective.selfAuthorizeWindowMs,
  });
  selfAuthorizeLimiter = { key, value };
  return value;
}
