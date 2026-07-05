import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import { createUser } from '@/lib/services/auth';
import { createOrg, getMembership } from '@/lib/services/orgs';
import {
  generateInvitationToken,
  createInvitation,
  getInvitationByToken,
  listInvitations,
  revokeInvitation,
  acceptInvitation,
} from '@/lib/services/invitations';

let creatorId: string;
let orgId: string;
let orgName: string;

beforeAll(async () => {
  setupTestDb();
  const creator = await createUser('inv-creator', 'password12345');
  creatorId = creator.id;
  const org = await createOrg({ name: 'Invite Co', createdById: creator.id });
  orgId = org.id;
  orgName = org.name;
});

afterAll(async () => {
  await getDb().$disconnect();
});

describe('generateInvitationToken', () => {
  it('generates inv_ tokens with 48 hex chars and a sha256 hash', () => {
    const { token, hashedToken } = generateInvitationToken();
    expect(token).toMatch(/^inv_[0-9a-f]{48}$/);
    expect(hashedToken).toBe(createHash('sha256').update(token).digest('hex'));
  });
});

describe('createInvitation', () => {
  it('stores only the hash and returns the plaintext token once', async () => {
    const { invitation, token } = await createInvitation({
      orgId,
      role: 'editor',
      createdById: creatorId,
      ttlMs: 60_000,
    });
    expect(token).toMatch(/^inv_/);
    const row = await getDb().invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(row.hashedToken).not.toBe(token);
    expect(row.hashedToken).toBe(createHash('sha256').update(token).digest('hex'));
    // Ensure the plaintext token never appears anywhere on the stored row.
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it('sets expiresAt from ttlMs', async () => {
    const before = Date.now();
    const { invitation } = await createInvitation({
      orgId,
      role: 'viewer',
      createdById: creatorId,
      ttlMs: 1000,
    });
    expect(invitation.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 1000);
    expect(invitation.expiresAt.getTime()).toBeLessThan(before + 5000);
  });
});

describe('getInvitationByToken', () => {
  it('returns org name and role for a valid token', async () => {
    const { token } = await createInvitation({
      orgId,
      role: 'admin',
      createdById: creatorId,
      ttlMs: 60_000,
    });
    const preview = await getInvitationByToken(token);
    expect(preview).toEqual({ orgId, orgName, role: 'admin' });
  });

  it('returns null for an unknown token', async () => {
    expect(await getInvitationByToken('inv_' + '0'.repeat(48))).toBeNull();
  });

  it('returns null for an expired token', async () => {
    const { token } = await createInvitation({
      orgId,
      role: 'viewer',
      createdById: creatorId,
      ttlMs: -1000,
    });
    expect(await getInvitationByToken(token)).toBeNull();
  });

  it('returns null for an already-accepted token', async () => {
    const { token } = await createInvitation({
      orgId,
      role: 'viewer',
      createdById: creatorId,
      ttlMs: 60_000,
    });
    const username = `acceptor_${Date.now()}`;
    await acceptInvitation({ token, username, password: 'password12345' });
    expect(await getInvitationByToken(token)).toBeNull();
  });
});

describe('listInvitations', () => {
  it('lists pending invitations without token/hash fields', async () => {
    const { invitation } = await createInvitation({
      orgId,
      role: 'viewer',
      email: 'someone@example.com',
      createdById: creatorId,
      ttlMs: 60_000,
    });
    const list = await listInvitations(orgId);
    const found = list.find((i) => i.id === invitation.id);
    expect(found).toEqual({
      id: invitation.id,
      role: 'viewer',
      email: 'someone@example.com',
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    });
    expect(found).not.toHaveProperty('hashedToken');
    expect(found).not.toHaveProperty('token');
  });

  it('excludes expired and accepted invitations', async () => {
    const { invitation: expired } = await createInvitation({
      orgId,
      role: 'viewer',
      createdById: creatorId,
      ttlMs: -1000,
    });
    const { token: acceptedToken, invitation: accepted } = await createInvitation({
      orgId,
      role: 'viewer',
      createdById: creatorId,
      ttlMs: 60_000,
    });
    await acceptInvitation({
      token: acceptedToken,
      username: `listaccept_${Date.now()}`,
      password: 'password12345',
    });
    const list = await listInvitations(orgId);
    const ids = list.map((i) => i.id);
    expect(ids).not.toContain(expired.id);
    expect(ids).not.toContain(accepted.id);
  });
});

describe('revokeInvitation', () => {
  it('deletes an invitation scoped to the org, returns false otherwise', async () => {
    const { invitation } = await createInvitation({
      orgId,
      role: 'viewer',
      createdById: creatorId,
      ttlMs: 60_000,
    });
    const otherOrg = await createOrg({ name: 'Other Org', createdById: creatorId });
    expect(await revokeInvitation(invitation.id, otherOrg.id)).toBe(false);
    expect(await revokeInvitation(invitation.id, orgId)).toBe(true);
    expect(await getDb().invitation.findUnique({ where: { id: invitation.id } })).toBeNull();
    expect(await revokeInvitation(invitation.id, orgId)).toBe(false);
  });
});

describe('acceptInvitation', () => {
  it('creates a user + membership with the invited role, marks acceptedAt, opens a session', async () => {
    const { token } = await createInvitation({
      orgId,
      role: 'admin',
      createdById: creatorId,
      ttlMs: 60_000,
    });
    const username = `newmember_${Date.now()}`;
    const result = await acceptInvitation({ token, username, password: 'password12345' });
    expect('error' in result).toBe(false);
    if ('error' in result) throw new Error('unexpected error result');
    expect(result.user.username).toBe(username);
    expect(result.user.role).toBe('user');
    expect(result.session.userId).toBe(result.user.id);

    const membership = await getMembership(result.user.id, orgId);
    expect(membership?.role).toBe('admin');

    const row = await getDb().invitation.findFirst({ where: { createdById: creatorId, role: 'admin' }, orderBy: { createdAt: 'desc' } });
    expect(row?.acceptedAt).not.toBeNull();
  });

  it('returns INVALID for an unknown token', async () => {
    const result = await acceptInvitation({
      token: 'inv_' + '1'.repeat(48),
      username: `invalid_${Date.now()}`,
      password: 'password12345',
    });
    expect(result).toEqual({ error: 'INVALID' });
  });

  it('returns EXPIRED for an expired token', async () => {
    const { token } = await createInvitation({
      orgId,
      role: 'viewer',
      createdById: creatorId,
      ttlMs: -1000,
    });
    const result = await acceptInvitation({
      token,
      username: `expired_${Date.now()}`,
      password: 'password12345',
    });
    expect(result).toEqual({ error: 'EXPIRED' });
  });

  it('returns USED on a second accept (single-use)', async () => {
    const { token } = await createInvitation({
      orgId,
      role: 'viewer',
      createdById: creatorId,
      ttlMs: 60_000,
    });
    const first = await acceptInvitation({
      token,
      username: `firstaccept_${Date.now()}`,
      password: 'password12345',
    });
    expect('error' in first).toBe(false);
    const second = await acceptInvitation({
      token,
      username: `secondaccept_${Date.now()}`,
      password: 'password12345',
    });
    expect(second).toEqual({ error: 'USED' });
  });

  it('returns USERNAME_TAKEN if the username already exists', async () => {
    const existing = await createUser(`taken_${Date.now()}`, 'password12345');
    const { token } = await createInvitation({
      orgId,
      role: 'viewer',
      createdById: creatorId,
      ttlMs: 60_000,
    });
    const result = await acceptInvitation({
      token,
      username: existing.username,
      password: 'password12345',
    });
    expect(result).toEqual({ error: 'USERNAME_TAKEN' });
  });
});
