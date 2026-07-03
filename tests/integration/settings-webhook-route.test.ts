import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { createTestUserAndSession } from '../helpers/auth';
import { getDb } from '@/lib/db/client';
import { GET as webhookGet, PUT as webhookPut } from '@/app/api/v1/settings/webhook/route';

let cookie: string;

beforeAll(async () => {
  setupTestDb();
  ({ cookie } = await createTestUserAndSession());
});

beforeEach(async () => {
  await getDb().setting.deleteMany();
});

afterAll(async () => {
  await getDb().$disconnect();
});

function req(method: string, body?: unknown, withAuth = true) {
  return new Request('http://x/api/v1/settings/webhook', {
    method,
    headers: {
      ...(withAuth ? { cookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('settings webhook route', () => {
  it('requires auth for GET', async () => {
    const res = await webhookGet(req('GET', undefined, false));
    expect(res.status).toBe(401);
  });

  it('requires auth for PUT', async () => {
    const res = await webhookPut(req('PUT', { url: 'https://example.com/hook' }, false));
    expect(res.status).toBe(401);
  });

  it('GET returns null url by default', async () => {
    const res = await webhookGet(req('GET'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: null });
  });

  it('PUT with a valid url persists it and GET returns it', async () => {
    const putRes = await webhookPut(req('PUT', { url: 'https://example.com/hook' }));
    expect(putRes.status).toBe(200);
    expect(await putRes.json()).toEqual({ url: 'https://example.com/hook' });

    const getRes = await webhookGet(req('GET'));
    expect(await getRes.json()).toEqual({ url: 'https://example.com/hook' });
  });

  it('PUT with an invalid url returns 400', async () => {
    const res = await webhookPut(req('PUT', { url: 'not-a-url' }));
    expect(res.status).toBe(400);
  });

  it('PUT with null clears the url', async () => {
    await webhookPut(req('PUT', { url: 'https://example.com/hook' }));
    const res = await webhookPut(req('PUT', { url: null }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: null });

    const getRes = await webhookGet(req('GET'));
    expect(await getRes.json()).toEqual({ url: null });
  });
});
