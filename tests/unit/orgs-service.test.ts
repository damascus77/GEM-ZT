import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import {
  slugify,
  createOrg,
  getMembership,
  setMemberRole,
  removeMember,
  addMembership,
  listMembersOfOrg,
  LastOwnerError,
} from '@/lib/services/orgs';

beforeAll(() => {
  setupTestDb();
});
afterAll(async () => {
  await getDb().$disconnect();
});

async function mkUser(name: string) {
  return getDb().user.create({ data: { username: name, passwordHash: 'x', role: 'user' } });
}

describe('orgs service', () => {
  it('slugifies names', () => {
    expect(slugify('Acme Corp!')).toBe('acme-corp');
    expect(slugify('  Multiple   Spaces ')).toBe('multiple-spaces');
  });

  it('creates an org with a unique slug and an owner membership', async () => {
    const u = await mkUser(`o1_${Date.now()}`);
    const a = await createOrg({ name: 'Dupe', createdById: u.id });
    const b = await createOrg({ name: 'Dupe', createdById: u.id });
    expect(a.slug).toBe('dupe');
    expect(b.slug).toBe('dupe-2');
    const m = await getMembership(u.id, a.id);
    expect(m?.role).toBe('owner');
  });

  it('protects the last owner from demotion/removal', async () => {
    const owner = await mkUser(`ow_${Date.now()}`);
    const org = await createOrg({ name: 'Solo', createdById: owner.id });
    await expect(setMemberRole(org.id, owner.id, 'admin')).rejects.toBeInstanceOf(LastOwnerError);
    await expect(removeMember(org.id, owner.id)).rejects.toBeInstanceOf(LastOwnerError);

    const second = await mkUser(`ow2_${Date.now()}`);
    await addMembership(org.id, second.id, 'owner');
    await setMemberRole(org.id, owner.id, 'admin'); // now allowed, 1 owner remains
    const members = await listMembersOfOrg(org.id);
    expect(members.find(m => m.userId === owner.id)?.role).toBe('admin');
  });
});
