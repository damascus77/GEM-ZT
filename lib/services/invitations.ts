import { createHash, randomBytes } from 'node:crypto';
import type { Invitation, Session, User } from '@prisma/client';
import { getDb } from '@/lib/db/client';
import type { OrgRole } from '@/lib/authz/roles';
import { createSession, createUser } from '@/lib/services/auth';
import { addMembership } from '@/lib/services/orgs';

export interface InvitationPreview {
  orgId: string;
  orgName: string;
  role: OrgRole;
}

export interface InvitationSummary {
  id: string;
  role: OrgRole;
  email: string | null;
  expiresAt: Date;
  createdAt: Date;
}

export type AcceptInvitationResult =
  | { user: User; session: Session }
  | { error: 'EXPIRED' | 'USED' | 'INVALID' | 'USERNAME_TAKEN' };

export function generateInvitationToken(): { token: string; hashedToken: string } {
  const token = `inv_${randomBytes(24).toString('hex')}`;
  return { token, hashedToken: createHash('sha256').update(token).digest('hex') };
}

export async function createInvitation(input: {
  orgId: string;
  role: OrgRole;
  email?: string;
  createdById: string;
  ttlMs: number;
}): Promise<{ invitation: Invitation; token: string }> {
  const { token, hashedToken } = generateInvitationToken();
  const invitation = await getDb().invitation.create({
    data: {
      orgId: input.orgId,
      role: input.role,
      email: input.email ?? null,
      createdById: input.createdById,
      hashedToken,
      expiresAt: new Date(Date.now() + input.ttlMs),
    },
  });
  return { invitation, token };
}

/**
 * Preview a token for the public "join" landing page. Returns null for any
 * invalid state (unknown / expired / already accepted) without distinguishing
 * which — callers that need to distinguish (for a 410 vs 404) re-check via
 * `getInvitationRowByToken`.
 */
export async function getInvitationByToken(token: string): Promise<InvitationPreview | null> {
  const row = await getInvitationRowByToken(token);
  if (!row || isExpired(row) || row.acceptedAt) return null;
  return { orgId: row.orgId, orgName: row.org.name, role: row.role as OrgRole };
}

/**
 * Raw lookup (hash the token, join the org) used internally by the preview and
 * accept flows so routes can distinguish unknown vs expired vs used without a
 * second query.
 */
export async function getInvitationRowByToken(
  token: string,
): Promise<(Invitation & { org: { name: string } }) | null> {
  const hashedToken = createHash('sha256').update(token).digest('hex');
  return getDb().invitation.findUnique({
    where: { hashedToken },
    include: { org: { select: { name: true } } },
  });
}

function isExpired(row: Invitation): boolean {
  return row.expiresAt.getTime() <= Date.now();
}

export async function listInvitations(orgId: string): Promise<InvitationSummary[]> {
  const rows = await getDb().invitation.findMany({
    where: { orgId, acceptedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, role: true, email: true, expiresAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => ({ ...r, role: r.role as OrgRole }));
}

export async function revokeInvitation(id: string, orgId: string): Promise<boolean> {
  const result = await getDb().invitation.deleteMany({ where: { id, orgId } });
  return result.count === 1;
}

export async function acceptInvitation(input: {
  token: string;
  username: string;
  password: string;
}): Promise<AcceptInvitationResult> {
  const row = await getInvitationRowByToken(input.token);
  if (!row) return { error: 'INVALID' };
  if (isExpired(row)) return { error: 'EXPIRED' };
  if (row.acceptedAt) return { error: 'USED' };

  const existing = await getDb().user.findUnique({ where: { username: input.username } });
  if (existing) return { error: 'USERNAME_TAKEN' };

  // Gate the accept on acceptedAt still being null in the same update, so two
  // concurrent accepts of the same token can't both succeed (single-use).
  const claim = await getDb().invitation.updateMany({
    where: { id: row.id, acceptedAt: null },
    data: { acceptedAt: new Date() },
  });
  if (claim.count === 0) return { error: 'USED' };

  const user = await createUser(input.username, input.password, 'user');
  await addMembership(row.orgId, user.id, row.role as OrgRole);
  const session = await createSession(user.id);
  return { user, session };
}
