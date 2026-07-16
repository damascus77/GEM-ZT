import { ControllerClient } from './client';
import { readAuthToken } from './token';
import { getEnv } from '@/lib/util/env';

let cached: ControllerClient | null = null;

export async function getControllerClient(): Promise<ControllerClient> {
  if (cached) return cached;
  const baseUrl = getEnv('ZT_CONTROLLER_URL', 'http://zerotier-controller:9993');
  const token = await readAuthToken();
  const parsedTimeout = Number(getEnv('ZT_CONTROLLER_TIMEOUT_MS', '8000'));
  const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 8000;
  cached = new ControllerClient({ baseUrl, token, timeoutMs });
  return cached;
}

/**
 * Drop the cached client so the next `getControllerClient()` re-reads the auth
 * token from disk/env. Call this after a controller auth failure: if the
 * controller regenerated its `authtoken.secret`, the app would otherwise 401
 * forever until restarted.
 */
export function invalidateControllerClient(): void {
  cached = null;
}

const DEFAULT_CACHE_TTL_MS = 3000;

/**
 * TTL (ms) for coalescing/caching controller reads (peers, member rosters).
 * Kept small so data stays fresh; it exists to collapse overlapping polls/tabs
 * into one controller sweep rather than to serve stale data. Validated the same
 * way as ZT_CONTROLLER_TIMEOUT_MS: non-numeric/non-positive falls back.
 */
export function getControllerCacheTtlMs(): number {
  const parsed = Number(getEnv('ZT_CONTROLLER_CACHE_TTL_MS', String(DEFAULT_CACHE_TTL_MS)));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CACHE_TTL_MS;
}
