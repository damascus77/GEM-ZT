import { createHash, randomBytes } from 'node:crypto';
import { getDb } from '@/lib/db/client';
import { updateMember } from './members';

// Self-authorize join tokens: a network admin mints a time-limited (optionally
// use-capped) token; a device that has run `zerotier-cli join <nwid>` can then
// authorize itself by presenting the token + its member id, without an admin
// having to click Authorize. Tokens are stored hashed (like invitations) so a
// DB leak doesn't hand out live tokens.

const TOKEN_PREFIX = 'jt_';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d ceiling
const MEMBER_ID_RE = /^[0-9a-f]{10}$/;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A random opaque token plus its sha256 (only the hash is ever stored). */
export function generateJoinToken(): { token: string; hashedToken: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(24).toString('hex')}`;
  return { token, hashedToken: hashToken(token) };
}

function clampTtl(ttlMs: number): number {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return DEFAULT_TTL_MS;
  return Math.min(ttlMs, MAX_TTL_MS);
}

export interface CreateJoinTokenInput {
  nwid: string;
  createdById: string;
  ttlMs?: number;
  maxUses?: number;
}

export interface JoinTokenView {
  id: string;
  nwid: string;
  maxUses: number;
  usedCount: number;
  expiresAt: string;
  createdAt: string;
}

/** Mint a token. Returns the plaintext token ONCE (never persisted) + a view. */
export async function createJoinToken(
  input: CreateJoinTokenInput
): Promise<{ token: string; view: JoinTokenView }> {
  const ttlMs = clampTtl(input.ttlMs ?? DEFAULT_TTL_MS);
  const maxUses = Math.max(0, Math.floor(input.maxUses ?? 0));
  const { token, hashedToken } = generateJoinToken();
  const row = await getDb().joinToken.create({
    data: {
      nwid: input.nwid,
      hashedToken,
      maxUses,
      createdById: input.createdById,
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });
  return { token, view: toView(row) };
}

function toView(row: {
  id: string;
  nwid: string;
  maxUses: number;
  usedCount: number;
  expiresAt: Date;
  createdAt: Date;
}): JoinTokenView {
  return {
    id: row.id,
    nwid: row.nwid,
    maxUses: row.maxUses,
    usedCount: row.usedCount,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Active = not revoked and not expired. */
export async function listActiveJoinTokens(nwid: string): Promise<JoinTokenView[]> {
  const rows = await getDb().joinToken.findMany({
    where: { nwid, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toView);
}

/** Revoke a token by id, scoped to its network. Returns false if not found. */
export async function revokeJoinToken(nwid: string, id: string): Promise<boolean> {
  const res = await getDb().joinToken.updateMany({
    where: { id, nwid, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return res.count > 0;
}

export type RedeemError = 'INVALID' | 'EXPIRED' | 'REVOKED' | 'EXHAUSTED' | 'NWID_MISMATCH';
export type RedeemResult = { ok: true } | { ok: false; error: RedeemError };

/**
 * Redeem a token to authorize `memberId` on `nwid`. The single use is claimed
 * atomically via a gated updateMany so concurrent redemptions can't push
 * usedCount past maxUses. A controller failure (e.g. the device hasn't actually
 * joined yet — updateMember 404s) rolls the consumed use back and rethrows, so
 * the caller can surface it without burning the token.
 */
export async function redeemJoinToken(input: {
  nwid: string;
  token: string;
  memberId: string;
}): Promise<RedeemResult> {
  const memberId = input.memberId.trim().toLowerCase();
  if (!MEMBER_ID_RE.test(memberId)) return { ok: false, error: 'INVALID' };

  const db = getDb();
  const row = await db.joinToken.findUnique({ where: { hashedToken: hashToken(input.token) } });
  if (!row) return { ok: false, error: 'INVALID' };
  if (row.nwid !== input.nwid) return { ok: false, error: 'NWID_MISMATCH' };

  const now = new Date();
  const claim = await db.joinToken.updateMany({
    where: {
      id: row.id,
      revokedAt: null,
      expiresAt: { gt: now },
      ...(row.maxUses > 0 ? { usedCount: { lt: row.maxUses } } : {}),
    },
    data: { usedCount: { increment: 1 } },
  });
  if (claim.count === 0) {
    // Re-read to report the specific reason the claim failed.
    const fresh = await db.joinToken.findUnique({ where: { id: row.id } });
    if (!fresh || fresh.revokedAt) return { ok: false, error: 'REVOKED' };
    if (fresh.expiresAt <= now) return { ok: false, error: 'EXPIRED' };
    return { ok: false, error: 'EXHAUSTED' };
  }

  try {
    await updateMember(input.nwid, memberId, { authorized: true });
  } catch (e) {
    await db.joinToken.updateMany({
      where: { id: row.id },
      data: { usedCount: { decrement: 1 } },
    });
    throw e;
  }
  return { ok: true };
}
