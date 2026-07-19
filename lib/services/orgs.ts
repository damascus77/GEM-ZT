import type { Membership, Organization } from '@prisma/client';
import { getDb } from '@/lib/db/client';
import type { OrgRole } from '@/lib/authz/roles';

export class LastOwnerError extends Error {
  constructor() {
    super('An organization must keep at least one owner.');
    this.name = 'LastOwnerError';
  }
}

export class OrgNotEmptyError extends Error {
  constructor() {
    super('This organization still has networks assigned to it. Reassign or delete them first.');
    this.name = 'OrgNotEmptyError';
  }
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function uniqueSlug(base: string): Promise<string> {
  const root = base || 'org';
  let candidate = root;
  let n = 1;
  // Append -2, -3, … until free.
  while (await getDb().organization.findUnique({ where: { slug: candidate } })) {
    n += 1;
    candidate = `${root}-${n}`;
  }
  return candidate;
}

export async function createOrg(input: {
  name: string;
  createdById: string;
}): Promise<Organization> {
  const slug = await uniqueSlug(slugify(input.name));
  // Create the org and its owner membership atomically. If the membership
  // insert fails, the org insert rolls back too, so an organization can never
  // exist without an owner (which would leave it unadministrable).
  return getDb().$transaction(async tx => {
    const org = await tx.organization.create({
      data: { name: input.name, slug, createdById: input.createdById },
    });
    await tx.membership.create({
      data: { orgId: org.id, userId: input.createdById, role: 'owner' },
    });
    return org;
  });
}

export function renameOrg(orgId: string, name: string): Promise<Organization> {
  return getDb().organization.update({ where: { id: orgId }, data: { name } });
}

export async function deleteOrg(orgId: string): Promise<void> {
  const networkCount = await getDb().networkMeta.count({ where: { orgId } });
  if (networkCount > 0) {
    throw new OrgNotEmptyError();
  }
  // Revoke org-scoped API keys and delete the org atomically. ApiKey.orgId has
  // no FK cascade, so keys would survive and authenticate against a deleted org
  // without this cleanup. Memberships/invitations cascade via schema onDelete.
  await getDb().$transaction([
    getDb().apiKey.deleteMany({ where: { orgId } }),
    getDb().organization.delete({ where: { id: orgId } }),
  ]);
}

export function getMembership(userId: string, orgId: string): Promise<Membership | null> {
  return getDb().membership.findUnique({ where: { userId_orgId: { userId, orgId } } });
}

export function listMembershipsForUser(userId: string) {
  return getDb().membership.findMany({
    where: { userId },
    include: { org: true },
    orderBy: { createdAt: 'asc' },
  });
}

export function listMembersOfOrg(orgId: string) {
  return getDb().membership.findMany({
    where: { orgId },
    include: { user: { select: { id: true, username: true } } },
    orderBy: { createdAt: 'asc' },
  });
}

export function addMembership(orgId: string, userId: string, role: OrgRole): Promise<Membership> {
  return getDb().membership.create({ data: { orgId, userId, role } });
}

export async function setMemberRole(orgId: string, userId: string, role: OrgRole): Promise<void> {
  // Read the current role, enforce the last-owner guard, and write the update
  // inside one transaction. Keeping the check and the write atomic prevents a
  // TOCTOU race where two concurrent demotions both pass the guard and leave
  // the org with zero owners.
  await getDb().$transaction(async tx => {
    const current = await tx.membership.findUnique({
      where: { userId_orgId: { userId, orgId } },
    });
    if (
      current?.role === 'owner' &&
      role !== 'owner' &&
      (await tx.membership.count({ where: { orgId, role: 'owner' } })) <= 1
    ) {
      throw new LastOwnerError();
    }
    await tx.membership.update({
      where: { userId_orgId: { userId, orgId } },
      data: { role },
    });
  });
}

export async function removeMember(orgId: string, userId: string): Promise<void> {
  // Enforce the last-owner guard and delete the membership plus all org-scoped
  // API keys inside one transaction. The check and both writes must be atomic:
  // concurrent removals can't strip the final owner, and a removed member can
  // never retain API access via a surviving credential.
  await getDb().$transaction(async tx => {
    const current = await tx.membership.findUnique({
      where: { userId_orgId: { userId, orgId } },
    });
    if (
      current?.role === 'owner' &&
      (await tx.membership.count({ where: { orgId, role: 'owner' } })) <= 1
    ) {
      throw new LastOwnerError();
    }
    await tx.membership.deleteMany({ where: { orgId, userId } });
    await tx.apiKey.deleteMany({ where: { userId, orgId } });
  });
}
