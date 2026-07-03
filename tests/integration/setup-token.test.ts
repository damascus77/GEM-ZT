import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import { GET as setupStatusGet } from '@/app/api/v1/setup/status/route';
import { POST as setupPost } from '@/app/api/v1/setup/route';

const TOKEN = 'test-setup-token-abc123';

function jsonReq(body: unknown) {
  return new Request('http://x/api/v1/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Isolated file so GEMZT_SETUP_TOKEN and the fresh DB don't affect other suites
// (vitest runs each test file in its own worker).
describe('setup bootstrap token', () => {
  beforeAll(() => {
    process.env.GEMZT_SETUP_TOKEN = TOKEN;
    setupTestDb();
  });

  afterAll(async () => {
    delete process.env.GEMZT_SETUP_TOKEN;
    await getDb().$disconnect();
  });

  it('advertises requiresToken=true on /setup/status', async () => {
    expect(await (await setupStatusGet()).json()).toMatchObject({
      needsSetup: true,
      requiresToken: true,
    });
  });

  it('rejects setup with no token (403 SETUP_TOKEN_INVALID)', async () => {
    const res = await setupPost(jsonReq({ username: 'admin', password: 'password12345' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('SETUP_TOKEN_INVALID');
    expect(await getDb().user.count()).toBe(0);
  });

  it('rejects setup with the wrong token (403)', async () => {
    const res = await setupPost(
      jsonReq({ username: 'admin', password: 'password12345', setupToken: 'wrong' }),
    );
    expect(res.status).toBe(403);
    expect(await getDb().user.count()).toBe(0);
  });

  it('creates the admin when the correct token is supplied (201)', async () => {
    const res = await setupPost(
      jsonReq({ username: 'admin', password: 'password12345', setupToken: TOKEN }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).user.username).toBe('admin');
    expect(res.headers.get('set-cookie')).toContain('gemzt_session=');
    expect(await getDb().user.count()).toBe(1);
  });
});
