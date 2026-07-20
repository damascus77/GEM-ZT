import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { createTestUserAndSession } from '../helpers/auth';
import { getDb } from '@/lib/db/client';
import {
  GET as notificationsGet,
  PUT as notificationsPut,
} from '@/app/api/v1/settings/notifications/route';

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
  return new Request('http://x/api/v1/settings/notifications', {
    method,
    headers: {
      ...(withAuth ? { cookie: useCookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('settings notifications route', () => {
  it('requires auth for GET', async () => {
    const res = await notificationsGet(req('GET', undefined, false));
    expect(res.status).toBe(401);
  });

  it('requires auth for PUT', async () => {
    const res = await notificationsPut(req('PUT', { emailRecipients: [], events: {} }, false));
    expect(res.status).toBe(401);
  });

  it('GET returns the empty default config', async () => {
    const res = await notificationsGet(req('GET'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ emailRecipients: [], events: {} });
  });

  it('PUT persists config and GET returns it (round-trip)', async () => {
    const cfg = {
      emailRecipients: ['ops@example.com', 'admin@example.com'],
      events: { 'member.unauthorized': true, 'controller.degraded': false },
    };
    const putRes = await notificationsPut(req('PUT', cfg));
    expect(putRes.status).toBe(200);
    expect(await putRes.json()).toEqual(cfg);

    const getRes = await notificationsGet(req('GET'));
    expect(await getRes.json()).toEqual(cfg);
  });

  it('PUT trims recipient whitespace', async () => {
    const putRes = await notificationsPut(
      req('PUT', { emailRecipients: ['  ops@example.com  '], events: {} })
    );
    expect(putRes.status).toBe(200);
    expect(await putRes.json()).toEqual({ emailRecipients: ['ops@example.com'], events: {} });
  });

  it('PUT with an invalid email returns 400', async () => {
    const res = await notificationsPut(
      req('PUT', { emailRecipients: ['not-an-email'], events: {} })
    );
    expect(res.status).toBe(400);
  });

  it('PUT with an empty-string recipient returns 400', async () => {
    const res = await notificationsPut(req('PUT', { emailRecipients: [''], events: {} }));
    expect(res.status).toBe(400);
  });

  it('PUT with an unknown event key returns 400', async () => {
    const res = await notificationsPut(
      req('PUT', { emailRecipients: [], events: { 'not.a.real.event': true } })
    );
    expect(res.status).toBe(400);
  });

  it('PUT with a non-boolean event value returns 400', async () => {
    const res = await notificationsPut(
      req('PUT', { emailRecipients: [], events: { 'member.unauthorized': 'yes' } })
    );
    expect(res.status).toBe(400);
  });

  it('PUT rejects unknown top-level keys (strict schema) with 400', async () => {
    const res = await notificationsPut(req('PUT', { emailRecipients: [], events: {}, bogus: 1 }));
    expect(res.status).toBe(400);
  });

  it('scopes config to the caller’s org', async () => {
    await notificationsPut(req('PUT', { emailRecipients: ['a@example.com'], events: {} }));
    const { cookie: otherCookie } = await createTestUserAndSession();
    const otherGet = await notificationsGet(req('GET', undefined, true, otherCookie));
    expect(await otherGet.json()).toEqual({ emailRecipients: [], events: {} });

    const mineGet = await notificationsGet(req('GET'));
    expect(await mineGet.json()).toEqual({ emailRecipients: ['a@example.com'], events: {} });
  });

  it('403s a non-admin (editor) session on GET and PUT', async () => {
    const { cookie: editorCookie } = await createTestUserAndSession({ role: 'editor' });
    const getRes = await notificationsGet(req('GET', undefined, true, editorCookie));
    expect(getRes.status).toBe(403);
    const putRes = await notificationsPut(
      req('PUT', { emailRecipients: [], events: {} }, true, editorCookie)
    );
    expect(putRes.status).toBe(403);
  });
});
