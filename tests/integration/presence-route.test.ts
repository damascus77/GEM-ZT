import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

vi.mock('@/lib/controller', () => ({ getControllerClient: vi.fn(), getControllerCacheTtlMs: () => 0 }));

import { getControllerClient } from '@/lib/controller';
import { setupTestDb } from '../helpers/db';
import { createTestUserAndSession } from '../helpers/auth';
import { getDb } from '@/lib/db/client';
import { GET as presenceGet } from '@/app/api/v1/networks/[nwid]/presence/route';

const NWID = 'abcdef0123456789';

const mockClient = {
  listMemberIds: vi.fn(),
  getMember: vi.fn(),
  updateMember: vi.fn(),
  deleteMember: vi.fn(),
  listPeers: vi.fn(),
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
  mockClient.listMemberIds.mockResolvedValue({});
  mockClient.listPeers.mockResolvedValue([]);
  await getDb().memberPresence.deleteMany();
  // Seed NWID's meta as belonging to the caller's active org so org-scoped
  // gating (assertNetworkInOrg) finds it.
  await getDb().networkMeta.upsert({
    where: { nwid: NWID },
    create: { nwid: NWID, name: 'lan', description: '', orgId },
    update: { orgId },
  });
});

afterAll(async () => {
  await getDb().$disconnect();
});

function req(url: string) {
  return new Request(url, { headers: { cookie } });
}

describe('presence route', () => {
  it('requires auth', async () => {
    const res = await presenceGet(new Request(`http://x/api/v1/networks/${NWID}/presence`), {
      params: Promise.resolve({ nwid: NWID }),
    });
    expect(res.status).toBe(401);
  });

  it('returns the presence map with auth', async () => {
    await getDb().memberPresence.create({
      data: { nwid: NWID, memberId: 'deadbeef01', online: true },
    });
    const res = await presenceGet(req(`http://x/api/v1/networks/${NWID}/presence`), {
      params: Promise.resolve({ nwid: NWID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.presence.deadbeef01.samples).toEqual([true]);
    expect(typeof body.presence.deadbeef01.lastSeen).toBe('string');
  });

  it('404s for a network outside the caller’s org', async () => {
    const OTHER_NWID = 'aaaa000011112222';
    await getDb().networkMeta.create({
      data: { nwid: OTHER_NWID, name: 'other', description: '', orgId: 'some-other-org-id' },
    });
    const res = await presenceGet(req(`http://x/api/v1/networks/${OTHER_NWID}/presence`), {
      params: Promise.resolve({ nwid: OTHER_NWID }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
    await getDb().networkMeta.delete({ where: { nwid: OTHER_NWID } });
  });
});
