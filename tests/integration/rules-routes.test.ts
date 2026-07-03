import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

vi.mock('@/lib/controller', () => ({ getControllerClient: vi.fn() }));

import { getControllerClient } from '@/lib/controller';
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

beforeAll(async () => {
  setupTestDb();
  ({ cookie } = await createTestUserAndSession());
});

beforeEach(async () => {
  vi.clearAllMocks();
  (getControllerClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
  mockClient.getNetwork.mockResolvedValue({
    id: NWID,
    nwid: NWID,
    rules: [{ type: 'ACTION_ACCEPT' }],
  });
  mockClient.updateNetwork.mockImplementation(async (_nwid: string, config: { rules: unknown[] }) => ({
    id: NWID,
    nwid: NWID,
    rules: config.rules,
  }));
  await getDb().networkMeta.deleteMany();
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
      params: { nwid: NWID },
    });
    expect(res.status).toBe(401);
  });

  it('GET returns the default source and live compiled rules when no source is stored', async () => {
    const res = await rulesGet(req('GET'), { params: { nwid: NWID } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toContain('accept;');
    expect(body.rules).toEqual([{ type: 'ACTION_ACCEPT' }]);
  });

  it('PUT compiles, pushes to the controller first, stores the source, audits', async () => {
    const res = await rulesPut(req('PUT', { source: 'accept;' }), { params: { nwid: NWID } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('accept;');
    expect(body.rules).toEqual([{ type: 'ACTION_ACCEPT' }]);
    expect(mockClient.updateNetwork).toHaveBeenCalledWith(
      NWID,
      expect.objectContaining({ rules: [expect.objectContaining({ type: 'ACTION_ACCEPT' })] }),
    );
    const meta = await getDb().networkMeta.findUnique({ where: { nwid: NWID } });
    expect(meta?.rulesSource).toBe('accept;');
    const audit = await getDb().auditLog.findFirst({ where: { action: 'network.rules.update' } });
    expect(audit?.targetId).toBe(NWID);
  });

  it('GET returns the stored source after a PUT', async () => {
    await rulesPut(req('PUT', { source: 'accept;' }), { params: { nwid: NWID } });
    const res = await rulesGet(req('GET'), { params: { nwid: NWID } });
    expect((await res.json()).source).toBe('accept;');
  });

  it('PUT returns 422 RULES_COMPILE_ERROR with line info for bad source', async () => {
    const res = await rulesPut(req('PUT', { source: 'acceptt;' }), { params: { nwid: NWID } });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('RULES_COMPILE_ERROR');
    expect(body.error.message).toMatch(/line \d+/);
    expect(mockClient.updateNetwork).not.toHaveBeenCalled();
  });

  it('PUT validates the body shape', async () => {
    const res = await rulesPut(req('PUT', { nope: true }), { params: { nwid: NWID } });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });
});
