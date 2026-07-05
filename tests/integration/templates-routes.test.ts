import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

vi.mock('@/lib/controller', () => ({ getControllerClient: vi.fn() }));

import { getControllerClient } from '@/lib/controller';
import { setupTestDb } from '../helpers/db';
import { createTestUserAndSession } from '../helpers/auth';
import { getDb } from '@/lib/db/client';
import { GET as listGet, POST as createPost } from '@/app/api/v1/templates/route';
import { DELETE as detailDelete } from '@/app/api/v1/templates/[id]/route';
import { POST as applyPost } from '@/app/api/v1/templates/[id]/apply/route';

const fakeNet = {
  id: 'abcdef0199999999',
  nwid: 'abcdef0199999999',
  name: 'lan',
  private: true,
  enableBroadcast: true,
  mtu: 2800,
  multicastLimit: 32,
  routes: [],
  ipAssignmentPools: [],
  v4AssignMode: { zt: true },
  v6AssignMode: { zt: false, '6plane': false, rfc4193: false },
  dns: { domain: '', servers: [] },
  rules: [],
  capabilities: [],
  tags: [],
  creationTime: 1,
  revision: 1,
};

const SRC_NWID = 'abcdef0123456789';

const mockClient = {
  getStatus: vi.fn(),
  getNetwork: vi.fn(),
  createNetwork: vi.fn(),
};

let cookie: string;
let orgId: string;

beforeAll(async () => {
  setupTestDb();
  ({ cookie, orgId } = await createTestUserAndSession());
});

beforeEach(async () => {
  vi.clearAllMocks();
  (getControllerClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
  mockClient.getStatus.mockResolvedValue({ address: 'abcdef0123', online: true, version: '1.14.2' });
  mockClient.getNetwork.mockResolvedValue(fakeNet);
  mockClient.createNetwork.mockResolvedValue(fakeNet);
  await getDb().networkTemplate.deleteMany();
  await getDb().networkMeta.deleteMany();
  await getDb().auditLog.deleteMany();
});

afterAll(async () => {
  await getDb().$disconnect();
});

function req(url: string, method: string, body?: unknown, withAuth = true) {
  return new Request(url, {
    method,
    headers: {
      ...(withAuth ? { cookie } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const config = {
  private: true,
  enableBroadcast: true,
  mtu: 2800,
  multicastLimit: 32,
  routes: [],
  ipAssignmentPools: [],
  v4AssignMode: { zt: true },
  v6AssignMode: { zt: false, '6plane': false, rfc4193: false },
  dns: { domain: '', servers: [] },
  rules: [],
  capabilities: [],
  tags: [],
};

describe('templates routes', () => {
  it('requires auth (401 envelope) on GET /templates', async () => {
    const res = await listGet(req('http://x/api/v1/templates', 'GET', undefined, false));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHORIZED');
  });

  it('GET /templates lists only the active org’s templates', async () => {
    await getDb().networkTemplate.create({
      data: { name: 'mine', config: JSON.stringify({ config, description: '', tags: '[]', rulesSource: '' }), orgId },
    });
    await getDb().networkTemplate.create({
      data: {
        name: 'other-org',
        config: JSON.stringify({ config, description: '', tags: '[]', rulesSource: '' }),
        orgId: 'some-other-org-id',
      },
    });
    const res = await listGet(req('http://x/api/v1/templates', 'GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.templates.map((t: any) => t.name)).toEqual(['mine']);
  });

  it('403s a viewer session on GET (below template:read? no — viewer can read; use write test below)', async () => {
    // template:read only requires viewer, so GET should succeed for a viewer.
    const { cookie: viewerCookie } = await createTestUserAndSession({ role: 'viewer' });
    const res = await listGet(
      new Request('http://x/api/v1/templates', { headers: { cookie: viewerCookie } }),
    );
    expect(res.status).toBe(200);
  });

  it('POST /templates creates a template scoped to the caller’s org and audits', async () => {
    const res = await createPost(
      req('http://x/api/v1/templates', 'POST', { nwid: SRC_NWID, name: 'from-network' }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.template.name).toBe('from-network');
    const row = await getDb().networkTemplate.findUnique({ where: { id: body.template.id } });
    expect(row?.orgId).toBe(orgId);
    const audit = await getDb().auditLog.findFirst({ where: { action: 'template.create' } });
    expect(audit?.targetId).toBe(body.template.id);
    expect(audit?.orgId).toBe(orgId);
  });

  it('POST /templates 403s a viewer session (below template:write)', async () => {
    const { cookie: viewerCookie } = await createTestUserAndSession({ role: 'viewer' });
    const res = await createPost(
      new Request('http://x/api/v1/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: viewerCookie },
        body: JSON.stringify({ nwid: SRC_NWID, name: 'x' }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('POST /templates returns 409 TEMPLATE_NAME_TAKEN for a duplicate name in the same org', async () => {
    await createPost(req('http://x/api/v1/templates', 'POST', { nwid: SRC_NWID, name: 'dup' }));
    const res = await createPost(
      req('http://x/api/v1/templates', 'POST', { nwid: SRC_NWID, name: 'dup' }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('TEMPLATE_NAME_TAKEN');
  });

  describe('DELETE /templates/{id}', () => {
    it('403s a viewer session (below template:write)', async () => {
      const created = await getDb().networkTemplate.create({
        data: { name: 'del-me', config: JSON.stringify({ config, description: '', tags: '[]', rulesSource: '' }), orgId },
      });
      const { cookie: viewerCookie } = await createTestUserAndSession({ role: 'viewer' });
      const res = await detailDelete(
        new Request(`http://x/api/v1/templates/${created.id}`, {
          method: 'DELETE',
          headers: { cookie: viewerCookie },
        }),
        { params: Promise.resolve({ id: created.id }) },
      );
      expect(res.status).toBe(403);
    });

    it('deletes a template and audits', async () => {
      const created = await getDb().networkTemplate.create({
        data: { name: 'del-me-2', config: JSON.stringify({ config, description: '', tags: '[]', rulesSource: '' }), orgId },
      });
      const res = await detailDelete(req(`http://x/api/v1/templates/${created.id}`, 'DELETE'), {
        params: Promise.resolve({ id: created.id }),
      });
      expect(res.status).toBe(204);
      const audit = await getDb().auditLog.findFirst({ where: { action: 'template.delete' } });
      expect(audit?.targetId).toBe(created.id);
    });
  });

  describe('POST /templates/{id}/apply', () => {
    it('403s a viewer session (below network:write)', async () => {
      const created = await getDb().networkTemplate.create({
        data: { name: 'apply-me', config: JSON.stringify({ config, description: '', tags: '[]', rulesSource: '' }), orgId },
      });
      const { cookie: viewerCookie } = await createTestUserAndSession({ role: 'viewer' });
      const res = await applyPost(
        new Request(`http://x/api/v1/templates/${created.id}/apply`, {
          method: 'POST',
          headers: { cookie: viewerCookie },
        }),
        { params: Promise.resolve({ id: created.id }) },
      );
      expect(res.status).toBe(403);
    });

    it('404s for a template outside the caller’s org', async () => {
      const created = await getDb().networkTemplate.create({
        data: {
          name: 'other-org-template',
          config: JSON.stringify({ config, description: '', tags: '[]', rulesSource: '' }),
          orgId: 'some-other-org-id',
        },
      });
      const res = await applyPost(req(`http://x/api/v1/templates/${created.id}/apply`, 'POST'), {
        params: Promise.resolve({ id: created.id }),
      });
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe('NOT_FOUND');
    });

    it('creates the new network into the caller’s org and audits', async () => {
      const created = await getDb().networkTemplate.create({
        data: { name: 'apply-me-2', config: JSON.stringify({ config, description: '', tags: '[]', rulesSource: '' }), orgId },
      });
      const res = await applyPost(req(`http://x/api/v1/templates/${created.id}/apply`, 'POST'), {
        params: Promise.resolve({ id: created.id }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.network.nwid).toBe(fakeNet.nwid);
      const meta = await getDb().networkMeta.findUnique({ where: { nwid: fakeNet.nwid } });
      expect(meta?.orgId).toBe(orgId);
      const audit = await getDb().auditLog.findFirst({ where: { action: 'template.apply' } });
      expect(audit?.targetId).toBe(fakeNet.nwid);
      expect(audit?.orgId).toBe(orgId);
    });
  });
});
