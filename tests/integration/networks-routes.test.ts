import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

vi.mock('@/lib/controller', () => ({ getControllerClient: vi.fn() }));

import { getControllerClient } from '@/lib/controller';
import { ControllerUnreachableError, ControllerApiError } from '@/lib/controller/client';
import { setupTestDb } from '../helpers/db';
import { createTestUserAndSession } from '../helpers/auth';
import { getDb } from '@/lib/db/client';
import { GET as listGet, POST as createPost } from '@/app/api/v1/networks/route';
import {
  GET as detailGet,
  PATCH as detailPatch,
  DELETE as detailDelete,
} from '@/app/api/v1/networks/[nwid]/route';

const NWID = 'abcdef0123456789';

const fakeNet = {
  id: NWID,
  nwid: NWID,
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

const mockClient = {
  getStatus: vi.fn(),
  listNetworkIds: vi.fn(),
  getNetwork: vi.fn(),
  createNetwork: vi.fn(),
  updateNetwork: vi.fn(),
  deleteNetwork: vi.fn(),
  listMemberIds: vi.fn(),
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
  mockClient.listNetworkIds.mockResolvedValue([NWID]);
  mockClient.getNetwork.mockResolvedValue(fakeNet);
  mockClient.createNetwork.mockResolvedValue(fakeNet);
  mockClient.updateNetwork.mockResolvedValue(fakeNet);
  mockClient.deleteNetwork.mockResolvedValue(undefined);
  mockClient.listMemberIds.mockResolvedValue({});
  // Seed NWID's meta as belonging to the caller's active org so org-scoped
  // reads/writes (listNetworksForOrg / getNetworkForOrg) find it.
  await getDb().networkMeta.upsert({
    where: { nwid: NWID },
    create: { nwid: NWID, name: 'lan', description: '', orgId },
    update: { orgId },
  });
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

describe('networks routes', () => {
  it('requires auth (401 envelope)', async () => {
    const res = await listGet(new Request('http://x/api/v1/networks'));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHORIZED');
  });

  it('GET /networks returns summaries', async () => {
    const res = await listGet(req('http://x/api/v1/networks', 'GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.networks[0].nwid).toBe(NWID);
    expect(body.networks[0]).toHaveProperty('memberCount');
  });

  it('POST /networks validates the body (400 VALIDATION_ERROR)', async () => {
    // name is optional now (blank => named after the nwid), so use an over-long
    // name to exercise validation.
    const res = await createPost(
      req('http://x/api/v1/networks', 'POST', { name: 'x'.repeat(101) }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /networks with no name creates a network named after its nwid', async () => {
    const res = await createPost(req('http://x/api/v1/networks', 'POST', {}));
    expect(res.status).toBe(201);
    const meta = await getDb().networkMeta.findUnique({ where: { nwid: NWID } });
    expect(meta?.name).toBe(NWID);
  });

  it('POST /networks creates and writes an audit entry', async () => {
    const res = await createPost(req('http://x/api/v1/networks', 'POST', { name: 'home' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.network.nwid).toBe(NWID);
    expect(body).toHaveProperty('metaWarning');
    const audit = await getDb().auditLog.findFirst({ where: { action: 'network.create' } });
    expect(audit?.targetId).toBe(NWID);
  });

  it('GET /networks/{nwid} returns detail; 404 when the controller does not know it', async () => {
    const ok = await detailGet(req(`http://x/api/v1/networks/${NWID}`, 'GET'), {
      params: Promise.resolve({ nwid: NWID }),
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).network.config.mtu).toBe(2800);
    mockClient.getNetwork.mockRejectedValueOnce(new ControllerApiError(404, 'gone'));
    const missing = await detailGet(req('http://x/api/v1/networks/0000000000000000', 'GET'), {
      params: Promise.resolve({ nwid: '0000000000000000' }),
    });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe('NOT_FOUND');
  });

  it('PATCH /networks/{nwid} updates and audits', async () => {
    const res = await detailPatch(
      req(`http://x/api/v1/networks/${NWID}`, 'PATCH', { mtu: 1400, description: 'd' }),
      { params: Promise.resolve({ nwid: NWID }) },
    );
    expect(res.status).toBe(200);
    expect(mockClient.updateNetwork).toHaveBeenCalledWith(NWID, { mtu: 1400 });
    const audit = await getDb().auditLog.findFirst({ where: { action: 'network.update' } });
    expect(audit?.targetId).toBe(NWID);
  });

  it('PATCH audits before/after snapshots', async () => {
    const res = await detailPatch(
      req(`http://x/api/v1/networks/${NWID}`, 'PATCH', { mtu: 1400 }),
      { params: Promise.resolve({ nwid: NWID }) },
    );
    expect(res.status).toBe(200);
    const audit = await getDb().auditLog.findFirst({
      where: { action: 'network.update' },
      orderBy: { createdAt: 'desc' },
    });
    const detail = JSON.parse(audit!.detail);
    expect(detail.before.config.mtu).toBe(2800);
    expect(detail.after).toEqual({ mtu: 1400 });
  });

  it('PATCH /networks/{nwid} 404s for an unknown nwid instead of creating a phantom network', async () => {
    // The controller upserts on POST, so without a GET-first guard a PATCH to a
    // typo'd/deleted nwid would silently mint a new (here: public) network.
    mockClient.getNetwork.mockRejectedValue(new ControllerApiError(404, 'gone'));
    const res = await detailPatch(
      req('http://x/api/v1/networks/0000000000000000', 'PATCH', { private: false }),
      { params: Promise.resolve({ nwid: '0000000000000000' }) },
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
    expect(mockClient.updateNetwork).not.toHaveBeenCalled();
  });

  it('PATCH rejects unknown fields (strict schema)', async () => {
    const res = await detailPatch(
      req(`http://x/api/v1/networks/${NWID}`, 'PATCH', { nope: true }),
      { params: Promise.resolve({ nwid: NWID }) },
    );
    expect(res.status).toBe(400);
  });

  it('DELETE /networks/{nwid} returns 204 and audits', async () => {
    const res = await detailDelete(req(`http://x/api/v1/networks/${NWID}`, 'DELETE'), {
      params: Promise.resolve({ nwid: NWID }),
    });
    expect(res.status).toBe(204);
    const audit = await getDb().auditLog.findFirst({ where: { action: 'network.delete' } });
    expect(audit?.targetId).toBe(NWID);
  });

  it('maps controller downtime to 502 CONTROLLER_UNREACHABLE', async () => {
    mockClient.listNetworkIds.mockRejectedValueOnce(new ControllerUnreachableError('down'));
    const res = await listGet(req('http://x/api/v1/networks', 'GET'));
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe('CONTROLLER_UNREACHABLE');
  });

  it('403s an editor-less (viewer) session on POST', async () => {
    const { cookie: viewerCookie } = await createTestUserAndSession({ role: 'viewer' });
    const res = await createPost(
      new Request('http://x/api/v1/networks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: viewerCookie },
        body: '{}',
      }),
    );
    expect(res.status).toBe(403);
  });

  it('GET /networks lists only the active org’s networks', async () => {
    // A second org's network (different NWID, different orgId meta) must not
    // appear for this caller.
    const OTHER_NWID = 'fedcba9876543210';
    await getDb().networkMeta.create({
      data: { nwid: OTHER_NWID, name: 'other', description: '', orgId: 'some-other-org-id' },
    });
    mockClient.listNetworkIds.mockResolvedValue([NWID, OTHER_NWID]);
    const res = await listGet(req('http://x/api/v1/networks', 'GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.networks.every((n: any) => n.nwid === NWID)).toBe(true);
    await getDb().networkMeta.delete({ where: { nwid: OTHER_NWID } });
  });

  it('GET /networks/{nwid} 404s for a network outside the caller’s org', async () => {
    const OTHER_NWID = 'aaaa000011112222';
    await getDb().networkMeta.create({
      data: { nwid: OTHER_NWID, name: 'other', description: '', orgId: 'some-other-org-id' },
    });
    const res = await detailGet(req(`http://x/api/v1/networks/${OTHER_NWID}`, 'GET'), {
      params: Promise.resolve({ nwid: OTHER_NWID }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
    await getDb().networkMeta.delete({ where: { nwid: OTHER_NWID } });
  });
});
