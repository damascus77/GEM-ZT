import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { createTestUserAndSession } from '../helpers/auth';
import { getDb } from '@/lib/db/client';
import { createApiKey } from '@/lib/services/apiKeys';
import { GET as keysGet, POST as keysPost } from '@/app/api/v1/apikeys/route';
import { DELETE as keyDelete } from '@/app/api/v1/apikeys/[id]/route';

let adminCookie: string;
let adminOrgId: string;
let ownerCookie: string;
let editorCookie: string;
let viewerCookie: string;

beforeAll(async () => {
  setupTestDb();
  ({ cookie: adminCookie, orgId: adminOrgId } = await createTestUserAndSession({ role: 'admin' }));
  ({ cookie: ownerCookie } = await createTestUserAndSession({ role: 'owner' }));
  ({ cookie: editorCookie } = await createTestUserAndSession({ role: 'editor' }));
  ({ cookie: viewerCookie } = await createTestUserAndSession({ role: 'viewer' }));
});

afterAll(async () => {
  await getDb().$disconnect();
});

function req(url: string, method: string, cookie: string, body?: unknown) {
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

  it('POST creates an org-scoped key, returns the full ztk_ key exactly once, audits', async () => {
    const res = await keysPost(
      req('http://x/api/v1/apikeys', 'POST', adminCookie, { name: 'ci', role: 'editor' })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.fullKey).toMatch(/^ztk_[0-9a-f]{48}$/);
    expect(body.apiKey.name).toBe('ci');
    expect(body.apiKey).not.toHaveProperty('hashedKey');
    const audit = await getDb().auditLog.findFirst({
      where: { action: 'apikey.create', targetId: body.apiKey.id },
    });
    expect(audit?.targetId).toBe(body.apiKey.id);
    expect(audit?.orgId).toBe(adminOrgId);
    const row = await getDb().apiKey.findUniqueOrThrow({ where: { id: body.apiKey.id } });
    expect(row.orgId).toBe(adminOrgId);
    expect(row.role).toBe('editor');
  });

  it('POST validates name, expiresAt, and role', async () => {
    const noName = await keysPost(
      req('http://x/api/v1/apikeys', 'POST', adminCookie, { name: '', role: 'viewer' })
    );
    expect(noName.status).toBe(400);
    const badDate = await keysPost(
      req('http://x/api/v1/apikeys', 'POST', adminCookie, {
        name: 'x',
        role: 'viewer',
        expiresAt: 'tomorrow',
      })
    );
    expect(badDate.status).toBe(400);
    const badRole = await keysPost(
      req('http://x/api/v1/apikeys', 'POST', adminCookie, { name: 'x', role: 'nope' })
    );
    expect(badRole.status).toBe(400);
  });

  it('role cap: admin cannot mint an owner-role key (403); owner can', async () => {
    const asAdmin = await keysPost(
      req('http://x/api/v1/apikeys', 'POST', adminCookie, { name: 'too-powerful', role: 'owner' })
    );
    expect(asAdmin.status).toBe(403);

    const asOwner = await keysPost(
      req('http://x/api/v1/apikeys', 'POST', ownerCookie, { name: 'owner-key', role: 'owner' })
    );
    expect(asOwner.status).toBe(201);
  });

  it('apikey:manage gate: editor/viewer are forbidden from create/list/delete', async () => {
    const editorCreate = await keysPost(
      req('http://x/api/v1/apikeys', 'POST', editorCookie, { name: 'x', role: 'viewer' })
    );
    expect(editorCreate.status).toBe(403);
    const viewerCreate = await keysPost(
      req('http://x/api/v1/apikeys', 'POST', viewerCookie, { name: 'x', role: 'viewer' })
    );
    expect(viewerCreate.status).toBe(403);

    const editorList = await keysGet(req('http://x/api/v1/apikeys', 'GET', editorCookie));
    expect(editorList.status).toBe(403);
    const viewerList = await keysGet(req('http://x/api/v1/apikeys', 'GET', viewerCookie));
    expect(viewerList.status).toBe(403);

    const editorDelete = await keyDelete(
      req('http://x/api/v1/apikeys/some-id', 'DELETE', editorCookie),
      { params: Promise.resolve({ id: 'some-id' }) }
    );
    expect(editorDelete.status).toBe(403);
  });

  it('GET lists keys scoped to the active org, excludes other orgs, without hashes or full keys', async () => {
    const { orgId: otherOrgId } = await createTestUserAndSession({ role: 'admin' });
    // Create a key directly in another org via the service (simulating org B's key).
    const { user: otherUser } = await createTestUserAndSession();
    await createApiKey(otherUser.id, 'org-b-key', undefined, { orgId: otherOrgId, role: 'viewer' });

    const res = await keysGet(req('http://x/api/v1/apikeys', 'GET', adminCookie));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.apiKeys.length).toBeGreaterThanOrEqual(1);
    expect(body.apiKeys[0]).toHaveProperty('prefix');
    expect(body.apiKeys[0]).not.toHaveProperty('hashedKey');
    expect(body.apiKeys[0]).not.toHaveProperty('fullKey');
    expect(body.apiKeys.find((k: { name: string }) => k.name === 'org-b-key')).toBeUndefined();
  });

  it('DELETE revokes a key (204), 404s for unknown ids, and cannot delete another org key', async () => {
    const created = await keysPost(
      req('http://x/api/v1/apikeys', 'POST', adminCookie, { name: 'temp', role: 'viewer' })
    );
    const { apiKey } = await created.json();
    const ok = await keyDelete(req(`http://x/api/v1/apikeys/${apiKey.id}`, 'DELETE', adminCookie), {
      params: Promise.resolve({ id: apiKey.id }),
    });
    expect(ok.status).toBe(204);
    const gone = await keyDelete(
      req(`http://x/api/v1/apikeys/${apiKey.id}`, 'DELETE', adminCookie),
      {
        params: Promise.resolve({ id: apiKey.id }),
      }
    );
    expect(gone.status).toBe(404);
    const audit = await getDb().auditLog.findFirst({
      where: { action: 'apikey.delete', targetId: apiKey.id },
    });
    expect(audit?.targetId).toBe(apiKey.id);

    // Another org's admin cannot delete this org's key (404, not found in their scope).
    const created2 = await keysPost(
      req('http://x/api/v1/apikeys', 'POST', adminCookie, { name: 'org-a-key', role: 'viewer' })
    );
    const { apiKey: apiKey2 } = await created2.json();
    const { cookie: otherAdminCookie } = await createTestUserAndSession({ role: 'admin' });
    const crossOrgDelete = await keyDelete(
      req(`http://x/api/v1/apikeys/${apiKey2.id}`, 'DELETE', otherAdminCookie),
      { params: Promise.resolve({ id: apiKey2.id }) }
    );
    expect(crossOrgDelete.status).toBe(404);
  });
});
