import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import { createUser } from '@/lib/services/auth';
import { POST as loginPost } from '@/app/api/v1/auth/login/route';

beforeAll(async () => {
  setupTestDb();
  await createUser('rl-admin', 'password12345');
});

afterAll(async () => {
  await getDb().$disconnect();
});

function loginReq(username: string, password: string) {
  return new Request('http://x/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

describe('login rate limiting', () => {
  it('blocks with 429 after repeated failures for the same username, then Retry-After', async () => {
    // The default limit is 5 failures per window; the 6th attempt is blocked.
    for (let i = 0; i < 5; i++) {
      const res = await loginPost(loginReq('rl-target', 'wrong'));
      expect(res.status).toBe(401);
    }
    const blocked = await loginPost(loginReq('rl-target', 'wrong'));
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error.code).toBe('RATE_LIMITED');
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
  });

  it('a successful login resets the counter for that username', async () => {
    for (let i = 0; i < 4; i++) {
      expect((await loginPost(loginReq('rl-admin', 'wrong'))).status).toBe(401);
    }
    // A correct login before the limit clears the failures…
    expect((await loginPost(loginReq('rl-admin', 'password12345'))).status).toBe(200);
    // …so a subsequent wrong attempt is a fresh 401, not a 429.
    expect((await loginPost(loginReq('rl-admin', 'wrong'))).status).toBe(401);
  });
});
