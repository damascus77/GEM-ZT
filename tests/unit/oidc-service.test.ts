import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import { computeMemberships, extractGroups, resolveOidcUser } from '@/lib/services/oidc';

beforeAll(() => {
  setupTestDb();
});

afterAll(async () => {
  await getDb().$disconnect();
});

const OIDC_ENV = {
  OIDC_ISSUER: 'https://idp.example.com',
  OIDC_CLIENT_ID: 'gemzt',
  OIDC_CLIENT_SECRET: 'secret',
  OIDC_REDIRECT_URI: 'https://panel.example.com/api/v1/auth/oidc/callback',
  OIDC_DEFAULT_ORG_SLUG: 'default-org',
  OIDC_DEFAULT_ROLE: 'viewer',
  OIDC_GROUPS_CLAIM: 'groups',
  OIDC_GROUP_MAP: JSON.stringify({
    admins: { orgSlug: 'default-org', role: 'admin' },
    'net-ops': { orgSlug: 'ops-org', role: 'editor' },
  }),
};

beforeEach(async () => {
  Object.assign(process.env, OIDC_ENV);
  await getDb().membership.deleteMany();
  await getDb().identity.deleteMany();
  await getDb().organization.deleteMany();
  await getDb().user.deleteMany();
});

afterEach(() => {
  for (const k of Object.keys(OIDC_ENV)) delete process.env[k as keyof typeof OIDC_ENV];
});

async function seedOrg(slug: string): Promise<string> {
  const u = await getDb().user.create({ data: { username: `${slug}-seed`, passwordHash: 'h' } });
  const org = await getDb().organization.create({ data: { name: slug, slug, createdById: u.id } });
  return org.id;
}

describe('extractGroups', () => {
  it('returns array claim values', () => {
    expect(extractGroups({ groups: ['a', 'b', 1] }, 'groups')).toEqual(['a', 'b']);
  });
  it('wraps a single string value', () => {
    expect(extractGroups({ groups: 'a' }, 'groups')).toEqual(['a']);
  });
  it('returns empty when claim absent or disabled', () => {
    expect(extractGroups({}, 'groups')).toEqual([]);
    expect(extractGroups({ groups: ['a'] }, null)).toEqual([]);
  });
});

describe('computeMemberships', () => {
  const cfg = {
    groupsClaim: 'groups',
    groupMap: {
      admins: { orgSlug: 'default-org', role: 'admin' as const },
      'net-ops': { orgSlug: 'ops-org', role: 'editor' as const },
    },
    defaultOrgSlug: 'default-org',
    defaultRole: 'viewer' as const,
  };

  it('maps matched groups to their orgs/roles', () => {
    expect(computeMemberships({ groups: ['net-ops'] }, cfg)).toEqual([
      { orgSlug: 'ops-org', role: 'editor' },
    ]);
  });

  it('falls back to the default org/role when no group matches', () => {
    expect(computeMemberships({ groups: ['unknown'] }, cfg)).toEqual([
      { orgSlug: 'default-org', role: 'viewer' },
    ]);
  });

  it('falls back to default when there are no groups at all', () => {
    expect(computeMemberships({}, cfg)).toEqual([{ orgSlug: 'default-org', role: 'viewer' }]);
  });

  it('keeps the highest role when several groups map to the same org', () => {
    const claims = { groups: ['admins'] };
    // admins -> default-org admin; default fallback is NOT applied because a
    // mapping matched.
    expect(computeMemberships(claims, cfg)).toEqual([{ orgSlug: 'default-org', role: 'admin' }]);
  });

  it('returns nothing when no match and no default configured', () => {
    expect(computeMemberships({ groups: [] }, { ...cfg, defaultOrgSlug: null })).toEqual([]);
  });
});

describe('resolveOidcUser', () => {
  it('provisions a passwordless user + identity and assigns the default org on first login', async () => {
    await seedOrg('default-org');
    const user = await resolveOidcUser({
      subject: 'sub-1',
      email: 'alice@example.com',
      claims: { sub: 'sub-1', email: 'alice@example.com', preferred_username: 'alice' },
    });

    expect(user.username).toBe('alice');
    expect(user.passwordHash).toBeNull();
    const identity = await getDb().identity.findUnique({
      where: { provider_subject: { provider: 'oidc', subject: 'sub-1' } },
    });
    expect(identity?.userId).toBe(user.id);
    const memberships = await getDb().membership.findMany({ where: { userId: user.id } });
    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe('viewer');
  });

  it('relinks to the existing user on a second login (no duplicate account)', async () => {
    await seedOrg('default-org');
    const first = await resolveOidcUser({
      subject: 'sub-1',
      email: 'a@example.com',
      claims: { sub: 'sub-1', preferred_username: 'alice' },
    });
    const second = await resolveOidcUser({
      subject: 'sub-1',
      email: 'a@example.com',
      claims: { sub: 'sub-1', preferred_username: 'alice' },
    });
    expect(second.id).toBe(first.id);
    expect(await getDb().user.count()).toBe(2); // 1 seed owner + 1 SSO user
  });

  it('applies group mapping and re-syncs role when claims change', async () => {
    await seedOrg('default-org');
    await seedOrg('ops-org');
    const u1 = await resolveOidcUser({
      subject: 'sub-2',
      email: null,
      claims: { sub: 'sub-2', preferred_username: 'bob', groups: ['net-ops'] },
    });
    let m = await getDb().membership.findMany({ where: { userId: u1.id }, include: { org: true } });
    expect(m.map(x => [x.org.slug, x.role])).toEqual([['ops-org', 'editor']]);

    // Second login: promoted to admins group -> gains default-org admin.
    await resolveOidcUser({
      subject: 'sub-2',
      email: null,
      claims: { sub: 'sub-2', preferred_username: 'bob', groups: ['net-ops', 'admins'] },
    });
    m = await getDb().membership.findMany({ where: { userId: u1.id }, include: { org: true } });
    const byOrg = Object.fromEntries(m.map(x => [x.org.slug, x.role]));
    expect(byOrg).toEqual({ 'ops-org': 'editor', 'default-org': 'admin' });
  });

  it('revokes an oidc membership when its group leaves the claim on a later login', async () => {
    await seedOrg('default-org');
    await seedOrg('ops-org');

    // First login: net-ops + admins -> ops-org editor AND default-org admin.
    const u = await resolveOidcUser({
      subject: 'sub-off',
      email: null,
      claims: { sub: 'sub-off', preferred_username: 'carol', groups: ['net-ops', 'admins'] },
    });
    let m = await getDb().membership.findMany({ where: { userId: u.id }, include: { org: true } });
    expect(Object.fromEntries(m.map(x => [x.org.slug, x.role]))).toEqual({
      'ops-org': 'editor',
      'default-org': 'admin',
    });
    expect(m.every(x => x.origin === 'oidc')).toBe(true);

    // Offboarded from net-ops: next login only carries admins.
    await resolveOidcUser({
      subject: 'sub-off',
      email: null,
      claims: { sub: 'sub-off', preferred_username: 'carol', groups: ['admins'] },
    });
    m = await getDb().membership.findMany({ where: { userId: u.id }, include: { org: true } });
    // ops-org (oidc, no longer granted) is revoked; default-org admin remains.
    expect(Object.fromEntries(m.map(x => [x.org.slug, x.role]))).toEqual({
      'default-org': 'admin',
    });
  });

  it('never touches a manual membership on SSO login (no downgrade, no delete)', async () => {
    await seedOrg('default-org');
    await seedOrg('ops-org');
    const manualOrgId = await seedOrg('manual-org');

    // Provision the SSO user (net-ops -> ops-org editor; no default fallback).
    const u = await resolveOidcUser({
      subject: 'sub-man',
      email: null,
      claims: { sub: 'sub-man', preferred_username: 'dave', groups: ['net-ops'] },
    });

    // Operator manually grants owner on an org SSO never mentions, plus a manual
    // grant on default-org (which the "admins" claim below would otherwise map to admin).
    await getDb().membership.create({
      data: { userId: u.id, orgId: manualOrgId, role: 'owner', origin: 'manual' },
    });
    const defaultOrg = await getDb().organization.findUnique({ where: { slug: 'default-org' } });
    await getDb().membership.create({
      data: { userId: u.id, orgId: defaultOrg!.id, role: 'owner', origin: 'manual' },
    });

    // Login again carrying admins (-> default-org admin) but no net-ops.
    await resolveOidcUser({
      subject: 'sub-man',
      email: null,
      claims: { sub: 'sub-man', preferred_username: 'dave', groups: ['admins'] },
    });

    const m = await getDb().membership.findMany({
      where: { userId: u.id },
      include: { org: true },
    });
    const byOrg = Object.fromEntries(m.map(x => [x.org.slug, { role: x.role, origin: x.origin }]));
    // Manual grant on an unrelated org survives untouched.
    expect(byOrg['manual-org']).toEqual({ role: 'owner', origin: 'manual' });
    // Manual grant on default-org is NOT downgraded/converted despite the admins mapping.
    expect(byOrg['default-org']).toEqual({ role: 'owner', origin: 'manual' });
    // The oidc ops-org grant was revoked (net-ops dropped from the claim).
    expect(byOrg['ops-org']).toBeUndefined();
  });

  it('derives a unique username when the preferred one is taken by another account', async () => {
    await seedOrg('default-org');
    await getDb().user.create({ data: { username: 'alice', passwordHash: 'h' } });
    const user = await resolveOidcUser({
      subject: 'sub-3',
      email: 'alice2@example.com',
      claims: { sub: 'sub-3', preferred_username: 'alice' },
    });
    expect(user.username).toBe('alice-2');
  });
});
