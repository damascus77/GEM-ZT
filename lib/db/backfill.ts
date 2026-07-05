import { getDb } from '@/lib/db/client';
import { createOrg, addMembership, getMembership } from '@/lib/services/orgs';

export const DEFAULT_ORG_SLUG = 'default';

/**
 * Idempotently ensure a "Default" org exists and every pre-multi-user row is
 * attributed to it. Safe to call on every boot. Returns the default org id, or
 * null when there are no users yet (fresh install — first-run setup will create
 * the org instead).
 */
export async function ensureDefaultOrgAndBackfill(): Promise<{ orgId: string } | null> {
  const db = getDb();
  if ((await db.user.count()) === 0) return null;

  let org = await db.organization.findUnique({ where: { slug: DEFAULT_ORG_SLUG } });
  if (!org) {
    const firstUser = await db.user.findFirst({ orderBy: { createdAt: 'asc' } });
    // createOrg makes firstUser an owner; we normalize the rest below.
    org = await createOrg({ name: 'Default', createdById: firstUser!.id });
    // createOrg forced slug from name ("default"); assert it matched the constant.
    if (org.slug !== DEFAULT_ORG_SLUG) {
      org = await db.organization.update({ where: { id: org.id }, data: { slug: DEFAULT_ORG_SLUG } });
    }
  }
  const orgId = org.id;

  // Legacy instance role "admin" (the v1 default) => super-admin.
  await db.user.updateMany({ where: { role: 'admin' }, data: { role: 'superadmin' } });

  // Every user gets an owner membership in the default org if they have none.
  const users = await db.user.findMany({ select: { id: true } });
  for (const u of users) {
    if (!(await getMembership(u.id, orgId))) {
      await addMembership(orgId, u.id, 'owner');
    }
  }

  // Attribute ownerless rows to the default org.
  await db.networkMeta.updateMany({ where: { orgId: null }, data: { orgId } });
  await db.apiKey.updateMany({ where: { orgId: null }, data: { orgId, role: 'owner' } });
  await db.auditLog.updateMany({ where: { orgId: null }, data: { orgId } });
  await db.networkTemplate.updateMany({ where: { orgId: null }, data: { orgId } });

  return { orgId };
}
