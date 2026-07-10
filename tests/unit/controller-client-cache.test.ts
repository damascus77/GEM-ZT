import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getControllerClient, invalidateControllerClient } from '@/lib/controller';

const savedToken = process.env.ZT_AUTH_TOKEN;

beforeEach(() => {
  // Read the token from env so no /controller/authtoken.secret file is needed.
  process.env.ZT_AUTH_TOKEN = 'test-controller-token';
  invalidateControllerClient();
});

afterAll(() => {
  process.env.ZT_AUTH_TOKEN = savedToken;
  invalidateControllerClient();
});

describe('getControllerClient caching', () => {
  it('reuses the cached client across calls', async () => {
    const a = await getControllerClient();
    const b = await getControllerClient();
    expect(a).toBe(b);
  });

  it('rebuilds the client after invalidateControllerClient (re-reads the token)', async () => {
    const a = await getControllerClient();
    invalidateControllerClient();
    const b = await getControllerClient();
    expect(a).not.toBe(b);
  });
});
