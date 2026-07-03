import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { createTestUserAndSession } from '../helpers/auth';
import { getDb } from '@/lib/db/client';
import { GET as keysGet, POST as keysPost } from '@/app/api/v1/apikeys/route';
import { DELETE as keyDelete } from '@/app/api/v1/apikeys/[id]/route';

let cookie: string;

beforeAll(async () => {
  setupTestDb();
  ({ cookie } = await createTestUserAndSession());
});

afterAll(async () => {
  await getDb().$disconnect();
});

function req(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json', cookie },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('apikeys routes', () => {
  it('requires auth', async () => {
    const res = await keysGet(new Request('http://x/api/v1/apikeys'));
    expect(res.status).toBe(401);
  });

  it('POST creates a key, returns the full ztk_ key exactly once, audits', async () => {
    const res = await keysPost(req('http://x/api/v1/apikeys', 'POST', { name: 'ci' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.fullKey).toMatch(/^ztk_[0-9a-f]{48}$/);
    expect(body.apiKey.name).toBe('ci');
    expect(body.apiKey).not.toHaveProperty('hashedKey');
    const audit = await getDb().auditLog.findFirst({ where: { action: 'apikey.create' } });
    expect(audit?.targetId).toBe(body.apiKey.id);
  });

  it('POST validates name and expiresAt', async () => {
    const noName = await keysPost(req('http://x/api/v1/apikeys', 'POST', { name: '' }));
    expect(noName.status).toBe(400);
    const badDate = await keysPost(
      req('http://x/api/v1/apikeys', 'POST', { name: 'x', expiresAt: 'tomorrow' }),
    );
    expect(badDate.status).toBe(400);
  });

  it('GET lists keys without hashes or full keys', async () => {
    const res = await keysGet(req('http://x/api/v1/apikeys', 'GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.apiKeys.length).toBeGreaterThanOrEqual(1);
    expect(body.apiKeys[0]).toHaveProperty('prefix');
    expect(body.apiKeys[0]).not.toHaveProperty('hashedKey');
    expect(body.apiKeys[0]).not.toHaveProperty('fullKey');
  });

  it('DELETE revokes a key (204) and 404s for unknown ids', async () => {
    const created = await keysPost(req('http://x/api/v1/apikeys', 'POST', { name: 'temp' }));
    const { apiKey } = await created.json();
    const ok = await keyDelete(req(`http://x/api/v1/apikeys/${apiKey.id}`, 'DELETE'), {
      params: { id: apiKey.id },
    });
    expect(ok.status).toBe(204);
    const gone = await keyDelete(req(`http://x/api/v1/apikeys/${apiKey.id}`, 'DELETE'), {
      params: { id: apiKey.id },
    });
    expect(gone.status).toBe(404);
    const audit = await getDb().auditLog.findFirst({ where: { action: 'apikey.delete' } });
    expect(audit?.targetId).toBe(apiKey.id);
  });
});
