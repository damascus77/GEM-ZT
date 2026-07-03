import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import { requireAuth } from '@/lib/api/auth';
import { createApiKey } from '@/lib/services/apiKeys';
import { createTestUserAndSession } from '../helpers/auth';

beforeAll(() => {
  setupTestDb();
});

afterAll(async () => {
  await getDb().$disconnect();
});

describe('requireAuth', () => {
  it('returns 401 envelope when no credentials are present', async () => {
    const result = await requireAuth(new Request('http://x/api/v1/networks'));
    expect(result).toBeInstanceOf(Response);
    const res = result as Response;
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHORIZED');
  });

  it('accepts a valid session cookie', async () => {
    const { user, cookie } = await createTestUserAndSession();
    const result = await requireAuth(
      new Request('http://x/api/v1/networks', { headers: { cookie } }),
    );
    expect(result).not.toBeInstanceOf(Response);
    expect((result as { user: { id: string } }).user.id).toBe(user.id);
  });

  it('accepts a valid Bearer ztk_ key', async () => {
    const { user } = await createTestUserAndSession();
    const { fullKey } = await createApiKey(user.id, 'bearer-test');
    const result = await requireAuth(
      new Request('http://x/api/v1/networks', {
        headers: { authorization: `Bearer ${fullKey}` },
      }),
    );
    expect(result).not.toBeInstanceOf(Response);
    expect((result as { user: { id: string } }).user.id).toBe(user.id);
  });

  it('accepts a lowercase "bearer" scheme (RFC 7235 case-insensitive)', async () => {
    const { user } = await createTestUserAndSession();
    const { fullKey } = await createApiKey(user.id, 'lowercase-bearer');
    const result = await requireAuth(
      new Request('http://x/api/v1/networks', {
        headers: { authorization: `bearer ${fullKey}` },
      }),
    );
    expect(result).not.toBeInstanceOf(Response);
    expect((result as { user: { id: string } }).user.id).toBe(user.id);
  });

  it('rejects an invalid Bearer key with 401', async () => {
    const result = await requireAuth(
      new Request('http://x/api/v1/networks', {
        headers: { authorization: `Bearer ztk_${'0'.repeat(48)}` },
      }),
    );
    expect((result as Response).status).toBe(401);
  });

  it('rejects an expired session with 401', async () => {
    const { user } = await createTestUserAndSession();
    const expired = await getDb().session.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() - 1000) },
    });
    const result = await requireAuth(
      new Request('http://x/api/v1/networks', {
        headers: { cookie: `gemzt_session=${expired.id}` },
      }),
    );
    expect((result as Response).status).toBe(401);
  });
});
