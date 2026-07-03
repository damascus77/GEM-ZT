import { ControllerClient } from './client';
import { readAuthToken } from './token';
import { getEnv } from '@/lib/util/env';

let cached: ControllerClient | null = null;

export async function getControllerClient(): Promise<ControllerClient> {
  if (cached) return cached;
  const baseUrl = getEnv('ZT_CONTROLLER_URL', 'http://zerotier-controller:9993');
  const token = await readAuthToken();
  cached = new ControllerClient({ baseUrl, token });
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
