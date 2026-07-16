import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

vi.mock('@/lib/controller', () => ({ getControllerClient: vi.fn(), getControllerCacheTtlMs: () => 0 }));

import { getControllerClient } from '@/lib/controller';
import { ControllerApiError } from '@/lib/controller/client';
import { setupTestDb } from '../helpers/db';
import { createTestUserAndSession } from '../helpers/auth';
import { getDb } from '@/lib/db/client';
import { GET as rulesGet, PUT as rulesPut } from '@/app/api/v1/networks/[nwid]/rules/route';

const NWID = 'abcdef0123456789';

const mockClient = {
  getNetwork: vi.fn(),
  updateNetwork: vi.fn(),
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
  mockClient.getNetwork.mockResolvedValue({
    id: NWID,
    nwid: NWID,
    rules: [{ type: 'ACTION_ACCEPT' }],
  });
  mockClient.updateNetwork.mockImplementation(
    async (_nwid: string, config: { rules: unknown[] }) => ({
      id: NWID,
      nwid: NWID,
      rules: config.rules,
    })
  );
  await getDb().networkMeta.deleteMany();
  // Seed NWID's meta as belonging to the caller's active org so org-scoped
  // gating (assertNetworkInOrg) finds it.
  await getDb().networkMeta.create({
    data: { nwid: NWID, name: 'lan', description: '', orgId },
  });
});

afterAll(async () => {
  await getDb().$disconnect();
});

function req(method: string, body?: unknown) {
  return new Request(`http://x/api/v1/networks/${NWID}/rules`, {
    method,
    headers: { 'Content-Type': 'application/json', cookie },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('rules routes', () => {
  it('requires auth', async () => {
    const res = await rulesGet(new Request(`http://x/api/v1/networks/${NWID}/rules`), {
      params: Promise.resolve({ nwid: NWID }),
    });
    expect(res.status).toBe(401);
  });

  it('GET returns the default source and live compiled rules when no source is stored', async () => {
    const res = await rulesGet(req('GET'), { params: Promise.resolve({ nwid: NWID }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toContain('accept;');
    expect(body.rules).toEqual([{ type: 'ACTION_ACCEPT' }]);
    // No stored rulesSource → showing the default template → callers must warn.
    expect(body.sourceIsDefault).toBe(true);
  });

  it('GET returns capability and tag name->id maps parsed from the stored source', async () => {
    const source = [
      'tag department',
      '  id 1000',
      '  enum 100 sales',
      '  enum 200 eng',
      ';',
      'cap superuser',
      '  id 2000',
      '  accept;',
      ';',
      'accept;',
    ].join('\n');
    await rulesPut(req('PUT', { source }), { params: Promise.resolve({ nwid: NWID }) });
    const res = await rulesGet(req('GET'), { params: Promise.resolve({ nwid: NWID }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.capabilities).toEqual({ superuser: 2000 });
    expect(body.tags).toEqual({ department: 1000 });
  });

  it('PUT compiles, pushes to the controller first, stores the source, audits', async () => {
    const res = await rulesPut(req('PUT', { source: 'accept;' }), {
      params: Promise.resolve({ nwid: NWID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('accept;');
    expect(body.rules).toEqual([{ type: 'ACTION_ACCEPT' }]);
    expect(mockClient.updateNetwork).toHaveBeenCalledWith(
      NWID,
      expect.objectContaining({ rules: [expect.objectContaining({ type: 'ACTION_ACCEPT' })] })
    );
    const meta = await getDb().networkMeta.findUnique({ where: { nwid: NWID } });
    expect(meta?.rulesSource).toBe('accept;');
    const audit = await getDb().auditLog.findFirst({ where: { action: 'network.rules.update' } });
    expect(audit?.targetId).toBe(NWID);
  });

  it('PUT audits before/after source snapshots', async () => {
    const res = await rulesPut(req('PUT', { source: 'accept;' }), {
      params: Promise.resolve({ nwid: NWID }),
    });
    expect(res.status).toBe(200);
    const audit = await getDb().auditLog.findFirst({
      where: { action: 'network.rules.update' },
      orderBy: { createdAt: 'desc' },
    });
    const detail = JSON.parse(audit!.detail);
    // No stored rulesSource yet → "before" falls back to the default template.
    expect(typeof detail.before).toBe('string');
    expect(detail.after).toBe('accept;');
  });

  it('GET returns the stored source after a PUT (no longer flagged as default)', async () => {
    await rulesPut(req('PUT', { source: 'accept;' }), { params: Promise.resolve({ nwid: NWID }) });
    const res = await rulesGet(req('GET'), { params: Promise.resolve({ nwid: NWID }) });
    const body = await res.json();
    expect(body.source).toBe('accept;');
    expect(body.sourceIsDefault).toBe(false);
  });

  it('PUT returns 422 RULES_COMPILE_ERROR with line info for bad source', async () => {
    const res = await rulesPut(req('PUT', { source: 'acceptt;' }), {
      params: Promise.resolve({ nwid: NWID }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('RULES_COMPILE_ERROR');
    expect(body.error.message).toMatch(/line \d+/);
    expect(mockClient.updateNetwork).not.toHaveBeenCalled();
  });

  it('PUT 404s for an unknown nwid instead of resurrecting a rules-only network', async () => {
    mockClient.getNetwork.mockRejectedValue(new ControllerApiError(404, 'gone'));
    const res = await rulesPut(req('PUT', { source: 'accept;' }), {
      params: Promise.resolve({ nwid: '0000000000000000' }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
    expect(mockClient.updateNetwork).not.toHaveBeenCalled();
  });

  it('PUT validates the body shape', async () => {
    const res = await rulesPut(req('PUT', { nope: true }), {
      params: Promise.resolve({ nwid: NWID }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('403s a viewer session on PUT (rules:write required)', async () => {
    const { cookie: viewerCookie } = await createTestUserAndSession({ role: 'viewer' });
    const res = await rulesPut(
      new Request(`http://x/api/v1/networks/${NWID}/rules`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', cookie: viewerCookie },
        body: JSON.stringify({ source: 'accept;' }),
      }),
      { params: Promise.resolve({ nwid: NWID }) }
    );
    expect(res.status).toBe(403);
  });

  it('GET /rules 404s for a network outside the caller’s org', async () => {
    const OTHER_NWID = 'aaaa000011112222';
    await getDb().networkMeta.create({
      data: { nwid: OTHER_NWID, name: 'other', description: '', orgId: 'some-other-org-id' },
    });
    const res = await rulesGet(
      new Request(`http://x/api/v1/networks/${OTHER_NWID}/rules`, { headers: { cookie } }),
      { params: Promise.resolve({ nwid: OTHER_NWID }) }
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
    await getDb().networkMeta.delete({ where: { nwid: OTHER_NWID } });
  });
});
