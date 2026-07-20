import * as client from 'openid-client';
import type { User } from '@prisma/client';
import { getDb } from '@/lib/db/client';
import { isOrgRole, type OrgRole } from '@/lib/authz/roles';

// Generic, discovery-based OIDC (works with Google, Okta, Authentik, Keycloak,
// Azure AD, etc.). GEM-ZT's schema was already SSO-ready: User.passwordHash is
// nullable and the Identity(provider, subject) table exists as the federation
// join point. This service handles the OIDC dance and provisions/links users;
// session issuance reuses the existing cookie mechanism in lib/services/auth.ts
// unchanged.
//
// All federated logins are stored under a single provider name; `subject` is
// the ID token `sub` claim, unique per IdP account.
export const OIDC_PROVIDER = 'oidc';

export class OidcNotConfiguredError extends Error {
  constructor() {
    super('OIDC/SSO is not configured on this instance.');
    this.name = 'OidcNotConfiguredError';
  }
}

export class OidcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OidcError';
  }
}

export interface GroupMapping {
  orgSlug: string;
  role: OrgRole;
}

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string;
  /** Org new SSO users land in when no group mapping matches. Null = none. */
  defaultOrgSlug: string | null;
  defaultRole: OrgRole;
  /** ID-token claim holding the user's groups (e.g. "groups"). Null = disabled. */
  groupsClaim: string | null;
  /** group value -> { orgSlug, role } */
  groupMap: Record<string, GroupMapping>;
}

function parseGroupMap(raw: string | undefined): Record<string, GroupMapping> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, { orgSlug?: unknown; role?: unknown }>;
    const out: Record<string, GroupMapping> = {};
    for (const [group, m] of Object.entries(parsed)) {
      if (typeof m?.orgSlug === 'string' && typeof m?.role === 'string' && isOrgRole(m.role)) {
        out[group] = { orgSlug: m.orgSlug, role: m.role };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Read OIDC config from the environment, or null if SSO isn't configured. */
export function getOidcConfig(): OidcConfig | null {
  const issuer = process.env.OIDC_ISSUER;
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;
  const redirectUri = process.env.OIDC_REDIRECT_URI;
  if (!issuer || !clientId || !clientSecret || !redirectUri) return null;

  const roleEnv = process.env.OIDC_DEFAULT_ROLE;
  const defaultRole: OrgRole = roleEnv && isOrgRole(roleEnv) ? roleEnv : 'viewer';

  return {
    issuer,
    clientId,
    clientSecret,
    redirectUri,
    scopes: process.env.OIDC_SCOPES ?? 'openid profile email',
    defaultOrgSlug: process.env.OIDC_DEFAULT_ORG_SLUG || null,
    defaultRole,
    groupsClaim: process.env.OIDC_GROUPS_CLAIM || null,
    groupMap: parseGroupMap(process.env.OIDC_GROUP_MAP),
  };
}

export function isOidcEnabled(): boolean {
  return getOidcConfig() !== null;
}

// Cache the discovered issuer Configuration per (issuer, clientId) so we don't
// hit the .well-known endpoint on every login. Discovery is network I/O and the
// metadata is effectively static for the process lifetime.
let discoveryCache: { key: string; config: Promise<client.Configuration> } | null = null;

async function getDiscoveredConfig(cfg: OidcConfig): Promise<client.Configuration> {
  const key = `${cfg.issuer}|${cfg.clientId}`;
  if (discoveryCache?.key !== key) {
    discoveryCache = {
      key,
      config: client.discovery(new URL(cfg.issuer), cfg.clientId, cfg.clientSecret),
    };
  }
  return discoveryCache.config;
}

/** Test-only: clear the memoized discovery result. */
export function resetOidcDiscoveryForTests(): void {
  discoveryCache = null;
}

export interface AuthStart {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

/**
 * Build the authorization-request URL plus the transient values (state, nonce,
 * PKCE verifier) the caller must stash in a short-lived cookie and hand back to
 * handleCallback for CSRF/replay protection.
 */
export async function buildAuthUrl(): Promise<AuthStart> {
  const cfg = getOidcConfig();
  if (!cfg) throw new OidcNotConfiguredError();
  const config = await getDiscoveredConfig(cfg);

  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const state = client.randomState();
  const nonce = client.randomNonce();

  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: cfg.redirectUri,
    scope: cfg.scopes,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  });

  return { url: url.href, state, nonce, codeVerifier };
}

export interface OidcIdentity {
  subject: string;
  email: string | null;
  claims: Record<string, unknown>;
}

/**
 * Complete the code exchange for the IdP's redirect back to us. `currentUrl` is
 * the full callback URL (with `code`/`state`). Verifies state, nonce, and PKCE.
 */
export async function handleCallback(
  currentUrl: URL,
  checks: { codeVerifier: string; expectedState: string; expectedNonce: string }
): Promise<OidcIdentity> {
  const cfg = getOidcConfig();
  if (!cfg) throw new OidcNotConfiguredError();
  const config = await getDiscoveredConfig(cfg);

  const tokens = await client.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: checks.codeVerifier,
    expectedState: checks.expectedState,
    expectedNonce: checks.expectedNonce,
  });

  const claims = tokens.claims();
  if (!claims?.sub) throw new OidcError('ID token is missing a subject (sub) claim.');
  const email = typeof claims.email === 'string' ? claims.email : null;
  return { subject: claims.sub, email, claims: claims as Record<string, unknown> };
}

/** Extract the string group values from the configured claim, if present. */
export function extractGroups(
  claims: Record<string, unknown>,
  groupsClaim: string | null
): string[] {
  if (!groupsClaim) return [];
  const raw = claims[groupsClaim];
  if (Array.isArray(raw)) return raw.filter((g): g is string => typeof g === 'string');
  if (typeof raw === 'string') return [raw];
  return [];
}

/**
 * Pure: decide which (orgSlug, role) memberships an SSO user should have, given
 * their claims. Any group that matches OIDC_GROUP_MAP wins; if none match, fall
 * back to the configured default org/role. Highest role wins when several
 * mapped groups point at the same org. No side effects — unit-tested directly.
 */
export function computeMemberships(
  claims: Record<string, unknown>,
  cfg: Pick<OidcConfig, 'groupsClaim' | 'groupMap' | 'defaultOrgSlug' | 'defaultRole'>
): GroupMapping[] {
  const groups = extractGroups(claims, cfg.groupsClaim);
  const byOrg = new Map<string, OrgRole>();
  for (const g of groups) {
    const mapping = cfg.groupMap[g];
    if (!mapping) continue;
    const existing = byOrg.get(mapping.orgSlug);
    if (!existing || rank(mapping.role) > rank(existing)) byOrg.set(mapping.orgSlug, mapping.role);
  }
  if (byOrg.size === 0 && cfg.defaultOrgSlug) {
    byOrg.set(cfg.defaultOrgSlug, cfg.defaultRole);
  }
  return Array.from(byOrg.entries()).map(([orgSlug, role]) => ({ orgSlug, role }));
}

const RANK: Record<OrgRole, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };
function rank(role: OrgRole): number {
  return RANK[role];
}

function deriveUsername(identity: OidcIdentity): string {
  const preferred = identity.claims['preferred_username'];
  if (typeof preferred === 'string' && preferred.trim()) return preferred.trim();
  if (identity.email) return identity.email;
  return `${OIDC_PROVIDER}:${identity.subject}`;
}

async function uniqueUsername(base: string, forUserId: string | null): Promise<string> {
  let candidate = base;
  let n = 1;
  // Free if unused, or already owned by the user we're provisioning.
  for (;;) {
    const existing = await getDb().user.findUnique({ where: { username: candidate } });
    if (!existing || existing.id === forUserId) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}

/** Provenance marking SSO-managed memberships; SSO never touches "manual" rows. */
const OIDC_ORIGIN = 'oidc';

/**
 * Reconcile a user's SSO-managed org memberships against their current claim.
 *
 * For every desired (orgSlug, role):
 *   - create it with origin="oidc" if absent;
 *   - if an "oidc" row exists, sync its role;
 *   - if a "manual" row exists, leave it exactly as-is — SSO only manages rows it
 *     created, so it never downgrades or converts an operator-assigned grant.
 *
 * Then REVOKE: delete every "oidc"-origin membership for this user whose org is
 * no longer in the desired set. This is what strips access from an offboarded
 * user removed from an IdP group (they used to keep the role forever). "manual"
 * rows are never deleted. Deletion is a direct delete of SSO-managed rows only.
 */
async function syncMemberships(userId: string, desired: GroupMapping[]): Promise<void> {
  const desiredOrgIds = new Set<string>();

  for (const { orgSlug, role } of desired) {
    const org = await getDb().organization.findUnique({ where: { slug: orgSlug } });
    if (!org) {
      console.error(
        `[gem-zt] OIDC group mapping references unknown org slug "${orgSlug}"; skipping`
      );
      continue;
    }
    desiredOrgIds.add(org.id);

    const existing = await getDb().membership.findUnique({
      where: { userId_orgId: { userId, orgId: org.id } },
    });
    if (existing && existing.origin !== OIDC_ORIGIN) {
      // Manual (operator-assigned) grant — leave untouched, don't downgrade/convert.
      continue;
    }
    await getDb().membership.upsert({
      where: { userId_orgId: { userId, orgId: org.id } },
      create: { userId, orgId: org.id, role, origin: OIDC_ORIGIN },
      update: { role, origin: OIDC_ORIGIN },
    });
  }

  // Revoke SSO-managed memberships for orgs no longer granted by the current claim.
  const stale = await getDb().membership.findMany({
    where: { userId, origin: OIDC_ORIGIN },
    select: { orgId: true },
  });
  const staleOrgIds = stale.map(m => m.orgId).filter(orgId => !desiredOrgIds.has(orgId));
  if (staleOrgIds.length > 0) {
    await getDb().membership.deleteMany({
      where: { userId, origin: OIDC_ORIGIN, orgId: { in: staleOrgIds } },
    });
  }
}

/**
 * Resolve an authenticated OIDC identity to a local User, auto-provisioning a
 * passwordless account on first login and (re)syncing org memberships from the
 * user's claims every time (so IdP group changes propagate). Returns the User;
 * the caller issues a session with createSessionWithOrg().
 */
export async function resolveOidcUser(identity: OidcIdentity): Promise<User> {
  const cfg = getOidcConfig();
  if (!cfg) throw new OidcNotConfiguredError();

  const desired = computeMemberships(identity.claims, cfg);

  const existingIdentity = await getDb().identity.findUnique({
    where: { provider_subject: { provider: OIDC_PROVIDER, subject: identity.subject } },
    include: { user: true },
  });

  let user: User;
  if (existingIdentity) {
    user = existingIdentity.user;
  } else {
    const username = await uniqueUsername(deriveUsername(identity), null);
    user = await getDb().$transaction(async tx => {
      const created = await tx.user.create({
        // Passwordless: passwordHash stays null. authenticateUser() already
        // refuses password login for such accounts.
        data: { username, role: 'user' },
      });
      await tx.identity.create({
        data: { userId: created.id, provider: OIDC_PROVIDER, subject: identity.subject },
      });
      return created;
    });
  }

  await syncMemberships(user.id, desired);
  return user;
}
