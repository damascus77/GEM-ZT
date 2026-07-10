import { createHash, randomBytes } from 'node:crypto';
import { Prisma, type Invitation, type Session, type User } from '@prisma/client';
import { getDb } from '@/lib/db/client';
import type { OrgRole } from '@/lib/authz/roles';
import { createSession, hashPassword } from '@/lib/services/auth';

export interface InvitationSummary {
  id: string;
  role: OrgRole;
  email: string | null;
  expiresAt: Date;
  createdAt: Date;
}

export type AcceptInvitationResult =
  { user: User; session: Session } | { error: 'EXPIRED' | 'USED' | 'INVALID' | 'USERNAME_TAKEN' };

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
 * Raw lookup (hash the token, join the org) used internally by the preview and
 * accept flows so routes can distinguish unknown vs expired vs used without a
 * second query.
 */
export async function getInvitationRowByToken(
  token: string
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
  return rows.map(r => ({ ...r, role: r.role as OrgRole }));
}

export async function revokeInvitation(id: string, orgId: string): Promise<boolean> {
  const result = await getDb().invitation.deleteMany({ where: { id, orgId } });
  return result.count === 1;
}

// Sentinel thrown inside the transaction when the conditional claim finds the
// invite already accepted (count === 0). Caught right below the
// `$transaction` call so the rollback maps to the existing USED result
// instead of surfacing as an unhandled rejection.
class InvitationAlreadyUsedError extends Error {}

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

  // Claim the invite, create the user, and add the membership atomically: if
  // user-create fails (e.g. a concurrent P2002 on username), the whole
  // transaction — including the acceptedAt claim below — rolls back, so a
  // failed accept never burns the single-use invite.
  let user: User;
  try {
    user = await getDb().$transaction(async tx => {
      // Gate the accept on acceptedAt still being null in the same update, so
      // two concurrent accepts of the same token can't both succeed
      // (single-use).
      const claim = await tx.invitation.updateMany({
        where: { id: row.id, acceptedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (claim.count === 0) throw new InvitationAlreadyUsedError();

      // Re-check-then-create is still racy under concurrent accepts of
      // distinct tokens with the same requested username; on a unique
      // violation, let it throw here so the transaction (including the claim
      // above) rolls back. The caller below catches it and maps it to the
      // same USERNAME_TAKEN result as the pre-check instead of surfacing a
      // raw 500.
      const created = await tx.user.create({
        data: {
          username: input.username,
          passwordHash: await hashPassword(input.password),
          role: 'user',
        },
      });
      await tx.membership.create({
        data: { orgId: row.orgId, userId: created.id, role: row.role as OrgRole },
      });
      return created;
    });
  } catch (e) {
    if (e instanceof InvitationAlreadyUsedError) return { error: 'USED' };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { error: 'USERNAME_TAKEN' };
    }
    throw e;
  }

  // Session creation happens after the transaction commits: it isn't part of
  // the atomic claim, and only needs to run once the user + membership exist.
  const session = await createSession(user.id);
  return { user, session };
}
