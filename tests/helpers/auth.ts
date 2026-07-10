import type { User } from '@prisma/client';
import { createSession, createUser, SESSION_COOKIE } from '@/lib/services/auth';
import { createOrg, setMemberRole } from '@/lib/services/orgs';
import { getDb } from '@/lib/db/client';
import type { OrgRole } from '@/lib/authz/roles';

let counter = 0;

export async function createTestUserAndSession(
  opts: { role?: OrgRole; superadmin?: boolean } = {}
): Promise<{ user: User; cookie: string; orgId: string }> {
  counter += 1;
  const user = await createUser(`admin${Date.now()}_${counter}`, 'password12345');
  const org = await createOrg({ name: `Org ${counter}`, createdById: user.id }); // user = owner
  if (opts.role && opts.role !== 'owner') {
    // add a second owner so the last-owner guard doesn't block demotion
    const co = await createUser(`co${Date.now()}_${counter}`, 'password12345');
    await getDb().membership.create({ data: { orgId: org.id, userId: co.id, role: 'owner' } });
    await setMemberRole(org.id, user.id, opts.role);
  }
  if (opts.superadmin) {
    await getDb().user.update({ where: { id: user.id }, data: { role: 'superadmin' } });
  }
  const session = await createSession(user.id);
  await getDb().session.update({ where: { id: session.id }, data: { activeOrgId: org.id } });
  return { user, cookie: `${SESSION_COOKIE}=${session.id}`, orgId: org.id };
}
