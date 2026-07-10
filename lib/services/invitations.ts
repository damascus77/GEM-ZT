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
  | { user: User; session: Session }
  | {
      error: 'EXPIRED' | 'USED' | 'INVALID' | 'USERNAME_TAKEN' | 'EMAIL_MISMATCH' | 'SESSION_ERROR';
    };

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
  // Only revoke pending invitations — accepted rows are membership audit records.
  const result = await getDb().invitation.deleteMany({ where: { id, orgId, acceptedAt: null } });
  return result.count === 1;
}

// Sentinels thrown inside the transaction to distinguish why the conditional
// claim returned count === 0 (used vs expired-in-window). Caught below the
// $transaction call so the rollback maps to the right result code.
class InvitationAlreadyUsedError extends Error {}
class InvitationExpiredError extends Error {}

export async function acceptInvitation(input: {
  token: string;
  username: string;
  password: string;
  email?: string;
}): Promise<AcceptInvitationResult> {
  const row = await getInvitationRowByToken(input.token);
  if (!row) return { error: 'INVALID' };
  if (isExpired(row)) return { error: 'EXPIRED' };
  if (row.acceptedAt) return { error: 'USED' };

  // If the invitation was issued to a specific email, the accepter must supply
  // the matching address. This prevents anyone who intercepts the link from
  // joining in place of the intended recipient.
  if (row.email && input.email?.toLowerCase() !== row.email.toLowerCase()) {
    return { error: 'EMAIL_MISMATCH' };
  }

  const existing = await getDb().user.findUnique({ where: { username: input.username } });
  if (existing) return { error: 'USERNAME_TAKEN' };

  // Hash the password before entering the transaction so we don't hold the
  // SQLite connection locked for the full argon2 duration (~100-500 ms).
  const passwordHash = await hashPassword(input.password);

  // Claim the invite, create the user, and add the membership atomically: if
  // user-create fails (e.g. a concurrent P2002 on username), the whole
  // transaction — including the acceptedAt claim below — rolls back, so a
  // failed accept never burns the single-use invite.
  let user: User;
  try {
    user = await getDb().$transaction(async tx => {
      // Gate the accept on acceptedAt still being null AND not yet expired in
      // the same update, so two concurrent accepts of the same token can't
      // both succeed (single-use), and an invitation that expired in the
      // window between the pre-check and the lock can't be claimed.
      const claim = await tx.invitation.updateMany({
        where: { id: row.id, acceptedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() },
      });
      if (claim.count === 0) {
        // Both "already accepted" and "expired between pre-check and lock" produce
        // count === 0. Re-query to tell them apart so the caller gets the right code.
        const still = await tx.invitation.findUnique({ where: { id: row.id } });
        if (still && still.acceptedAt) throw new InvitationAlreadyUsedError();
        throw new InvitationExpiredError();
      }

      // Re-check-then-create is still racy under concurrent accepts of
      // distinct tokens with the same requested username; on a unique
      // violation, let it throw here so the transaction (including the claim
      // above) rolls back.
      const created = await tx.user.create({
        data: { username: input.username, passwordHash, role: 'user' },
      });
      await tx.membership.create({
        data: { orgId: row.orgId, userId: created.id, role: row.role as OrgRole },
      });
      return created;
    });
  } catch (e) {
    if (e instanceof InvitationAlreadyUsedError) return { error: 'USED' };
    if (e instanceof InvitationExpiredError) return { error: 'EXPIRED' };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { error: 'USERNAME_TAKEN' };
    }
    throw e;
  }

  // Session creation happens after the transaction commits. If it fails the
  // account exists and the invite is consumed — return SESSION_ERROR so the
  // client can redirect to /login rather than showing a generic 500.
  try {
    const session = await createSession(user.id);
    return { user, session };
  } catch {
    return { error: 'SESSION_ERROR' };
  }
}
