import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import { createUser } from '@/lib/services/auth';
import {
  createOrg,
  setMemberRole,
  removeMember,
  addMembership,
  getMembership,
  LastOwnerError,
} from '@/lib/services/orgs';

beforeAll(() => {
  setupTestDb();
});
afterAll(async () => {
  await getDb().$disconnect();
});

let counter = 0;
function uniqueName(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now()}_${counter}`;
}

describe('createOrg atomicity', () => {
  it('creates the org and the owner membership together', async () => {
    const user = await createUser(uniqueName('owner'), 'password12345');
    const name = uniqueName('Happy Org');

    const org = await createOrg({ name, createdById: user.id });

    const stored = await getDb().organization.findUnique({ where: { id: org.id } });
    expect(stored?.name).toBe(name);

    const membership = await getMembership(user.id, org.id);
    expect(membership?.role).toBe('owner');
  });

  it('rolls back the org when the owner membership insert fails', async () => {
    // A createdById with no matching User row satisfies Organization.create
    // (no FK on createdById) but violates Membership.userId's FK, so the
    // membership insert throws. With both writes in one transaction the org
    // must be rolled back rather than left ownerless.
    const name = uniqueName('Ghost Org');

    await expect(createOrg({ name, createdById: 'nonexistent-user-id' })).rejects.toThrow();

    const orgs = await getDb().organization.findMany({ where: { name } });
    expect(orgs).toHaveLength(0);
  });
});

describe('setMemberRole last-owner guard', () => {
  it('throws LastOwnerError when demoting the sole owner', async () => {
    const owner = await createUser(uniqueName('sole'), 'password12345');
    const org = await createOrg({ name: uniqueName('Solo Org'), createdById: owner.id });

    await expect(setMemberRole(org.id, owner.id, 'admin')).rejects.toBeInstanceOf(LastOwnerError);

    const membership = await getMembership(owner.id, org.id);
    expect(membership?.role).toBe('owner');
  });

  it('demotes an owner when at least two owners exist', async () => {
    const owner = await createUser(uniqueName('first'), 'password12345');
    const org = await createOrg({ name: uniqueName('Duo Org'), createdById: owner.id });
    const owner2 = await createUser(uniqueName('second'), 'password12345');
    await addMembership(org.id, owner2.id, 'owner');

    await setMemberRole(org.id, owner.id, 'admin');

    const membership = await getMembership(owner.id, org.id);
    expect(membership?.role).toBe('admin');
    const remainingOwners = await getDb().membership.count({
      where: { orgId: org.id, role: 'owner' },
    });
    expect(remainingOwners).toBe(1);
  });
});

describe('removeMember last-owner guard and api-key cleanup', () => {
  it('throws LastOwnerError removing the sole owner', async () => {
    const owner = await createUser(uniqueName('lastowner'), 'password12345');
    const org = await createOrg({ name: uniqueName('Guard Org'), createdById: owner.id });

    await expect(removeMember(org.id, owner.id)).rejects.toBeInstanceOf(LastOwnerError);

    const membership = await getMembership(owner.id, org.id);
    expect(membership?.role).toBe('owner');
  });

  it('removes a member and deletes their org-scoped api keys atomically', async () => {
    const owner = await createUser(uniqueName('keeper'), 'password12345');
    const org = await createOrg({ name: uniqueName('Keys Org'), createdById: owner.id });
    const member = await createUser(uniqueName('member'), 'password12345');
    await addMembership(org.id, member.id, 'editor');

    // An org-scoped key that must be revoked, and an instance key that must survive.
    await getDb().apiKey.create({
      data: {
        userId: member.id,
        orgId: org.id,
        role: 'editor',
        name: 'scoped',
        prefix: 'aaaaaaaa',
        hashedKey: uniqueName('scopedhash'),
      },
    });
    await getDb().apiKey.create({
      data: {
        userId: member.id,
        orgId: null,
        name: 'instance',
        prefix: 'bbbbbbbb',
        hashedKey: uniqueName('instancehash'),
      },
    });

    await removeMember(org.id, member.id);

    const membership = await getMembership(member.id, org.id);
    expect(membership).toBeNull();

    const scopedKeys = await getDb().apiKey.findMany({
      where: { userId: member.id, orgId: org.id },
    });
    expect(scopedKeys).toHaveLength(0);

    const survivingKeys = await getDb().apiKey.findMany({ where: { userId: member.id } });
    expect(survivingKeys).toHaveLength(1);
    expect(survivingKeys[0].name).toBe('instance');
  });
});
