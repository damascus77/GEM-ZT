import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

vi.mock('@/lib/controller', () => ({ getControllerClient: vi.fn() }));

import { getControllerClient } from '@/lib/controller';
import { ControllerApiError } from '@/lib/controller/client';
import { setupTestDb } from '../helpers/db';
import { createTestUserAndSession } from '../helpers/auth';
import { getDb } from '@/lib/db/client';
import { GET as membersGet } from '@/app/api/v1/networks/[nwid]/members/route';
import {
  GET as memberGet,
  PATCH as memberPatch,
  DELETE as memberDelete,
} from '@/app/api/v1/networks/[nwid]/members/[memberId]/route';

const NWID = 'abcdef0123456789';
const MID = 'deadbeef01';

const fakeMember = {
  id: MID,
  nwid: NWID,
  authorized: false,
  activeBridge: false,
  ipAssignments: [],
  noAutoAssignIps: false,
  capabilities: [],
  tags: [],
  lastAuthorizedTime: 0,
  creationTime: 1,
  revision: 1,
  vMajor: 1,
  vMinor: 14,
  vRev: 2,
};

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
  mockClient.listMemberIds.mockResolvedValue({ [MID]: 1 });
  mockClient.getMember.mockResolvedValue(fakeMember);
  mockClient.updateMember.mockResolvedValue({ ...fakeMember, authorized: true });
  mockClient.deleteMember.mockResolvedValue(undefined);
  mockClient.listPeers.mockResolvedValue([]);
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

function req(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json', cookie },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('members routes', () => {
  it('requires auth', async () => {
    const res = await membersGet(new Request(`http://x/api/v1/networks/${NWID}/members`), {
      params: Promise.resolve({ nwid: NWID }),
    });
    expect(res.status).toBe(401);
  });

  it('GET lists members with presence fields', async () => {
    const res = await membersGet(req(`http://x/api/v1/networks/${NWID}/members`, 'GET'), {
      params: Promise.resolve({ nwid: NWID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members[0].memberId).toBe(MID);
    expect(body.members[0].online).toBeNull();
  });

  it('GET single member 404s when unknown', async () => {
    mockClient.getMember.mockRejectedValueOnce(new ControllerApiError(404, 'gone'));
    const res = await memberGet(
      req(`http://x/api/v1/networks/${NWID}/members/ffffffffff`, 'GET'),
      { params: Promise.resolve({ nwid: NWID, memberId: 'ffffffffff' }) },
    );
    expect(res.status).toBe(404);
  });

  it('PATCH authorizes a member, assigns an IP, and audits', async () => {
    const res = await memberPatch(
      req(`http://x/api/v1/networks/${NWID}/members/${MID}`, 'PATCH', {
        authorized: true,
        ipAssignments: ['10.147.17.10'],
        name: 'laptop',
      }),
      { params: Promise.resolve({ nwid: NWID, memberId: MID }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.member.authorized).toBe(true);
    expect(mockClient.updateMember).toHaveBeenCalledWith(NWID, MID, {
      authorized: true,
      ipAssignments: ['10.147.17.10'],
    });
    const audit = await getDb().auditLog.findFirst({ where: { action: 'member.update' } });
    expect(audit?.targetId).toBe(`${NWID}/${MID}`);
  });

  it('PATCH audits before/after snapshots', async () => {
    const res = await memberPatch(
      req(`http://x/api/v1/networks/${NWID}/members/${MID}`, 'PATCH', {
        authorized: true,
      }),
      { params: Promise.resolve({ nwid: NWID, memberId: MID }) },
    );
    expect(res.status).toBe(200);
    const audit = await getDb().auditLog.findFirst({
      where: { action: 'member.update' },
      orderBy: { createdAt: 'desc' },
    });
    const detail = JSON.parse(audit!.detail);
    expect(detail.before.authorized).toBe(false);
    expect(detail.after).toEqual({ authorized: true });
  });

  it('PATCH rejects invalid IPs with VALIDATION_ERROR', async () => {
    const res = await memberPatch(
      req(`http://x/api/v1/networks/${NWID}/members/${MID}`, 'PATCH', {
        ipAssignments: ['not-an-ip'],
      }),
      { params: Promise.resolve({ nwid: NWID, memberId: MID }) },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('DELETE removes the member and audits', async () => {
    const res = await memberDelete(
      req(`http://x/api/v1/networks/${NWID}/members/${MID}`, 'DELETE'),
      { params: Promise.resolve({ nwid: NWID, memberId: MID }) },
    );
    expect(res.status).toBe(204);
    const audit = await getDb().auditLog.findFirst({ where: { action: 'member.delete' } });
    expect(audit?.targetId).toBe(`${NWID}/${MID}`);
  });

  it('403s a viewer session on PATCH (member:write required)', async () => {
    const { cookie: viewerCookie } = await createTestUserAndSession({ role: 'viewer' });
    const res = await memberPatch(
      new Request(`http://x/api/v1/networks/${NWID}/members/${MID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie: viewerCookie },
        body: JSON.stringify({ authorized: true }),
      }),
      { params: Promise.resolve({ nwid: NWID, memberId: MID }) },
    );
    expect(res.status).toBe(403);
  });

  it('GET /members 404s for a network outside the caller’s org', async () => {
    const OTHER_NWID = 'aaaa000011112222';
    await getDb().networkMeta.create({
      data: { nwid: OTHER_NWID, name: 'other', description: '', orgId: 'some-other-org-id' },
    });
    const res = await membersGet(req(`http://x/api/v1/networks/${OTHER_NWID}/members`, 'GET'), {
      params: Promise.resolve({ nwid: OTHER_NWID }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
    await getDb().networkMeta.delete({ where: { nwid: OTHER_NWID } });
  });

  it('GET single member 404s for a network outside the caller’s org', async () => {
    const OTHER_NWID = 'bbbb000011112222';
    await getDb().networkMeta.create({
      data: { nwid: OTHER_NWID, name: 'other', description: '', orgId: 'some-other-org-id' },
    });
    const res = await memberGet(
      req(`http://x/api/v1/networks/${OTHER_NWID}/members/${MID}`, 'GET'),
      { params: Promise.resolve({ nwid: OTHER_NWID, memberId: MID }) },
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
    await getDb().networkMeta.delete({ where: { nwid: OTHER_NWID } });
  });
});
