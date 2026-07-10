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

function req(method: string, body?: unknown, withAuth = true, useCookie = cookie) {
  return new Request('http://x/api/v1/settings/webhook', {
    method,
    headers: {
      ...(withAuth ? { cookie: useCookie } : {}),
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
    const res = await webhookPut(req('PUT', { newMemberUrl: 'https://example.com/hook' }, false));
    expect(res.status).toBe(401);
  });

  it('GET returns null newMemberUrl by default', async () => {
    const res = await webhookGet(req('GET'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ newMemberUrl: null });
  });

  it('PUT with a valid url persists it and GET returns it', async () => {
    const putRes = await webhookPut(req('PUT', { newMemberUrl: 'https://example.com/hook' }));
    expect(putRes.status).toBe(200);
    expect(await putRes.json()).toEqual({ newMemberUrl: 'https://example.com/hook' });

    const getRes = await webhookGet(req('GET'));
    expect(await getRes.json()).toEqual({ newMemberUrl: 'https://example.com/hook' });
  });

  it('PUT with an invalid url returns 400', async () => {
    const res = await webhookPut(req('PUT', { newMemberUrl: 'not-a-url' }));
    expect(res.status).toBe(400);
  });

  it('PUT rejects SSRF-unsafe URLs (private/loopback/metadata) with 400 and does not persist', async () => {
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost:9993/controller/network',
      'http://192.168.1.1/hook',
    ]) {
      const res = await webhookPut(req('PUT', { newMemberUrl: url }));
      expect(res.status, url).toBe(400);
    }
    const getRes = await webhookGet(req('GET'));
    expect(await getRes.json()).toEqual({ newMemberUrl: null });
  });

  it('PUT with null clears the url', async () => {
    await webhookPut(req('PUT', { newMemberUrl: 'https://example.com/hook' }));
    const res = await webhookPut(req('PUT', { newMemberUrl: null }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ newMemberUrl: null });

    const getRes = await webhookGet(req('GET'));
    expect(await getRes.json()).toEqual({ newMemberUrl: null });
  });

  it('scopes config to the caller’s org (a different org sees its own, independent config)', async () => {
    await webhookPut(req('PUT', { newMemberUrl: 'https://example.com/org-a' }));
    const { cookie: otherCookie } = await createTestUserAndSession();
    const otherGet = await webhookGet(req('GET', undefined, true, otherCookie));
    expect(await otherGet.json()).toEqual({ newMemberUrl: null });

    const mineGet = await webhookGet(req('GET'));
    expect(await mineGet.json()).toEqual({ newMemberUrl: 'https://example.com/org-a' });
  });

  it('403s a non-admin (editor) session on GET and PUT (webhook:manage requires admin)', async () => {
    const { cookie: editorCookie } = await createTestUserAndSession({ role: 'editor' });
    const getRes = await webhookGet(req('GET', undefined, true, editorCookie));
    expect(getRes.status).toBe(403);
    const putRes = await webhookPut(
      req('PUT', { newMemberUrl: 'https://example.com/hook' }, true, editorCookie)
    );
    expect(putRes.status).toBe(403);
  });
});
