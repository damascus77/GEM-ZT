import type { Membership, Organization } from '@prisma/client';
import { getDb } from '@/lib/db/client';
import type { OrgRole } from '@/lib/authz/roles';

export class LastOwnerError extends Error {
  constructor() {
    super('An organization must keep at least one owner.');
    this.name = 'LastOwnerError';
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
  const org = await getDb().organization.create({
    data: { name: input.name, slug, createdById: input.createdById },
  });
  await getDb().membership.create({
    data: { orgId: org.id, userId: input.createdById, role: 'owner' },
  });
  return org;
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

async function ownerCount(orgId: string): Promise<number> {
  return getDb().membership.count({ where: { orgId, role: 'owner' } });
}

export async function setMemberRole(orgId: string, userId: string, role: OrgRole): Promise<void> {
  const current = await getMembership(userId, orgId);
  if (current?.role === 'owner' && role !== 'owner' && (await ownerCount(orgId)) <= 1) {
    throw new LastOwnerError();
  }
  await getDb().membership.update({
    where: { userId_orgId: { userId, orgId } },
    data: { role },
  });
}

export async function removeMember(orgId: string, userId: string): Promise<void> {
  const current = await getMembership(userId, orgId);
  if (current?.role === 'owner' && (await ownerCount(orgId)) <= 1) {
    throw new LastOwnerError();
  }
  await getDb().membership.deleteMany({ where: { orgId, userId } });
}
