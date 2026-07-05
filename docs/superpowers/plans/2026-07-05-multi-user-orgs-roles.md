# Multi-user, Organizations, and Roles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn GEM-ZT from a single-admin controller UI into a multi-tenant system with organizations, per-org roles (Owner/Admin/Editor/Viewer), an instance super-admin, multi-org membership, and invite/direct-create onboarding — enforced by a route-boundary policy module plus mandatory org-scoped data accessors.

**Architecture:** A `Membership(userId, orgId, role)` join is the source of truth for authorization. Every API route calls `requireOrgRole(req, action)` (checks a pure `can(role, action)` policy) or `requireSuperAdmin(req)`; org-owned data is reached only through accessors that require an `orgId` argument, so a forgotten role check cannot leak another org's rows. Existing global controller networks are owned via `NetworkMeta.orgId`. An idempotent boot-time backfill migrates the current single-admin deployment into a "Default" org. `passwordHash` becomes optional and an `Identity` table is added as seams so a future OIDC login is additive.

**Tech Stack:** Next.js 15 (App Router, Route Handlers), Prisma 5 + SQLite, argon2, zod, Vitest, React 18 + TanStack Query, Tailwind.

**Spec:** [docs/superpowers/specs/2026-07-05-multi-user-orgs-roles-design.md](../specs/2026-07-05-multi-user-orgs-roles-design.md)

## Global Constraints

- **Roles are string-typed** (SQLite has no enums): instance role `"superadmin" | "user"`; org role `"owner" | "admin" | "editor" | "viewer"`. Never introduce a Prisma enum.
- **Test DB is schema-driven:** tests build the DB with `npx prisma db push --skip-generate --force-reset` from `prisma/schema.prisma` (see `tests/helpers/db.ts`), starting empty. Data-migration logic therefore lives in a runnable TS function tested against a hand-seeded DB — never only in migration SQL.
- **Every API route validates input with zod** at the boundary and returns the existing error envelope `{ error: { code, message } }` via `apiError` / `handleRouteError` (`lib/api/errors.ts`). Add `403 FORBIDDEN` for authorization failures.
- **TDD:** write the failing test first, watch it fail, implement minimally, watch it pass, commit. Commit after every green step.
- **Path alias:** imports use `@/…` (repo root). Follow existing file conventions.
- **Commands:** `npm test` (all), `npx vitest run <path>` (one file), `npm run typecheck`. On Windows use `npx` as shown.
- **Auth resolution precedence** (unchanged order): API-key `Authorization: Bearer ztk_…` first, then `gemzt_session` cookie.

---

## Phase 1 — Schema & migration

Ships a schema that models orgs/memberships/invitations/identities and an idempotent backfill that converts an existing single-admin install into a "Default" org. No authorization behavior changes yet: after Phase 1 every existing user is a super-admin and an owner of the one default org, so all current tests still pass.

### Task 1: Prisma schema — orgs, memberships, invitations, identities, org-scoping columns

**Files:**
- Modify: `prisma/schema.prisma`
- Create (generated): `prisma/migrations/<timestamp>_multi_user_orgs/migration.sql` (authored by Prisma)
- Test: `tests/unit/db-schema.test.ts` (extend existing)

**Interfaces:**
- Produces: Prisma models `Organization`, `Membership`, `Invitation`, `Identity`; new columns `User.role` (default `"user"`), `User.passwordHash String?`, `Session.activeOrgId String?`, `NetworkMeta.orgId String?`, `ApiKey.orgId String?`, `ApiKey.role String?`, `AuditLog.orgId String?`, `NetworkTemplate.orgId String?`.

- [ ] **Step 1: Write the failing schema test**

Extend `tests/unit/db-schema.test.ts` (it already exercises `getDb()` against a pushed schema). Add:

```ts
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
// ...existing beforeAll(setupTestDb) stays...

it('models organizations, memberships, invitations, identities', async () => {
  const db = getDb();
  const user = await db.user.create({
    data: { username: `u_${Date.now()}`, passwordHash: null, role: 'superadmin' },
  });
  const org = await db.organization.create({
    data: { name: 'Acme', slug: `acme-${Date.now()}`, createdById: user.id },
  });
  const m = await db.membership.create({
    data: { userId: user.id, orgId: org.id, role: 'owner' },
  });
  expect(m.role).toBe('owner');

  const inv = await db.invitation.create({
    data: {
      orgId: org.id,
      role: 'editor',
      hashedToken: `h_${Date.now()}`,
      createdById: user.id,
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  expect(inv.acceptedAt).toBeNull();

  const id = await db.identity.create({
    data: { userId: user.id, provider: 'oidc', subject: 'sub-123' },
  });
  expect(id.provider).toBe('oidc');

  // org-scoping columns exist and are nullable
  const net = await db.networkMeta.create({ data: { nwid: 'n1', orgId: org.id } });
  expect(net.orgId).toBe(org.id);
});

it('allows a passwordless user (OIDC seam)', async () => {
  const u = await getDb().user.create({
    data: { username: `oidc_${Date.now()}`, passwordHash: null, role: 'user' },
  });
  expect(u.passwordHash).toBeNull();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/db-schema.test.ts`
Expected: FAIL — `organization`/`membership`/`identity` are not properties of the Prisma client; `passwordHash: null` rejected.

- [ ] **Step 3: Edit `prisma/schema.prisma`**

Change `User`, `Session`, `NetworkMeta`, `ApiKey`, `AuditLog`, `NetworkTemplate` and add the four new models:

```prisma
model User {
  id           String       @id @default(cuid())
  username     String       @unique
  passwordHash String?
  role         String       @default("user")   // instance role: "superadmin" | "user"
  totpSecret   String?
  totpEnabled  Boolean      @default(false)
  createdAt    DateTime     @default(now())
  apiKeys      ApiKey[]
  sessions     Session[]
  auditLogs    AuditLog[]
  memberships  Membership[]
  identities   Identity[]
}

model Organization {
  id          String       @id @default(cuid())
  name        String
  slug        String       @unique
  createdById String
  createdAt   DateTime     @default(now())
  memberships Membership[]
  invitations Invitation[]
}

model Membership {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  orgId     String
  org       Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  role      String   // "owner" | "admin" | "editor" | "viewer"
  createdAt DateTime @default(now())

  @@unique([userId, orgId])
  @@index([orgId])
}

model Invitation {
  id          String    @id @default(cuid())
  orgId       String
  org         Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  role        String
  hashedToken String    @unique
  email       String?
  createdById String
  expiresAt   DateTime
  acceptedAt  DateTime?
  createdAt   DateTime  @default(now())

  @@index([orgId])
}

model Identity {
  id       String @id @default(cuid())
  userId   String
  user     User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider String
  subject  String

  @@unique([provider, subject])
  @@index([userId])
}

model Session {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  activeOrgId String?
  expiresAt   DateTime
}

model NetworkMeta {
  nwid        String   @id
  orgId       String?
  name        String   @default("")
  description String   @default("")
  tags        String   @default("[]")
  rulesSource String   @default("")
  createdAt   DateTime @default(now())

  @@index([orgId])
}

model ApiKey {
  id         String    @id @default(cuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  orgId      String?
  role       String?   // org role this key acts as; null = instance key (super-admin)
  name       String
  prefix     String
  hashedKey  String    @unique
  lastUsedAt DateTime?
  createdAt  DateTime  @default(now())
  expiresAt  DateTime?

  @@index([orgId])
}

model AuditLog {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  orgId      String?
  action     String
  targetType String
  targetId   String
  detail     String   @default("{}")
  createdAt  DateTime @default(now())

  @@index([orgId])
}

model NetworkTemplate {
  id        String   @id @default(cuid())
  orgId     String?
  name      String
  config    String
  createdAt DateTime @default(now())

  @@index([orgId])
}
```

Note: `NetworkTemplate.name` loses its global `@unique` (names are now unique per org, enforced in the service, not the schema — SQLite can't express a partial unique across nullable orgId cleanly here).

- [ ] **Step 4: Run the schema test to verify it passes**

Run: `npx vitest run tests/unit/db-schema.test.ts`
Expected: PASS (db push rebuilds the temp DB from the new schema).

- [ ] **Step 5: Generate the production migration**

Run: `npx prisma migrate dev --name multi_user_orgs --create-only`
This authors `prisma/migrations/<timestamp>_multi_user_orgs/migration.sql` (Prisma handles the SQLite table-rebuild needed to make `passwordHash` nullable). Open the file and confirm it creates the four tables and adds the nullable columns; do not hand-edit.

- [ ] **Step 6: Full test + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS. `npm run typecheck` will surface the two intended breakages next: `createUser`/`toDetail` etc. still compile (nullable `passwordHash` only affects reads). If typecheck flags `user.passwordHash` used where a non-null string is required, note them — Task 2/6 address auth call-sites.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations tests/unit/db-schema.test.ts
git commit -m "feat(schema): add orgs, memberships, invitations, identities; org-scope columns"
```

### Task 2: Role constants & types

**Files:**
- Create: `lib/authz/roles.ts`
- Test: `tests/unit/roles.test.ts`

**Interfaces:**
- Produces: `type InstanceRole`, `type OrgRole`, `ORG_ROLES`, `ROLE_RANK`, `isOrgRole(x): x is OrgRole`, `SUPERADMIN`, `USER`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { ORG_ROLES, ROLE_RANK, isOrgRole } from '@/lib/authz/roles';

describe('roles', () => {
  it('orders roles viewer < editor < admin < owner', () => {
    expect(ROLE_RANK.viewer).toBeLessThan(ROLE_RANK.editor);
    expect(ROLE_RANK.editor).toBeLessThan(ROLE_RANK.admin);
    expect(ROLE_RANK.admin).toBeLessThan(ROLE_RANK.owner);
  });
  it('validates org roles', () => {
    expect(isOrgRole('owner')).toBe(true);
    expect(isOrgRole('superadmin')).toBe(false);
    expect(ORG_ROLES).toEqual(['owner', 'admin', 'editor', 'viewer']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/roles.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/authz/roles.ts`**

```ts
export type InstanceRole = 'superadmin' | 'user';
export type OrgRole = 'owner' | 'admin' | 'editor' | 'viewer';

export const SUPERADMIN: InstanceRole = 'superadmin';
export const USER: InstanceRole = 'user';

export const ORG_ROLES: OrgRole[] = ['owner', 'admin', 'editor', 'viewer'];

export const ROLE_RANK: Record<OrgRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
};

export function isOrgRole(x: string): x is OrgRole {
  return (ORG_ROLES as string[]).includes(x);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/roles.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/authz/roles.ts tests/unit/roles.test.ts
git commit -m "feat(authz): add instance/org role constants and ranking"
```

### Task 3: Membership & organization service

**Files:**
- Create: `lib/services/orgs.ts`
- Test: `tests/unit/orgs-service.test.ts`

**Interfaces:**
- Consumes: `OrgRole` from `lib/authz/roles`.
- Produces:
  - `slugify(name: string): string`
  - `createOrg(input: { name: string; createdById: string }): Promise<Organization>` (unique slug via collision suffix; creator gets an `owner` membership)
  - `getMembership(userId: string, orgId: string): Promise<Membership | null>`
  - `listMembershipsForUser(userId: string): Promise<(Membership & { org: Organization })[]>`
  - `listMembersOfOrg(orgId: string): Promise<(Membership & { user: { id: string; username: string } })[]>`
  - `setMemberRole(orgId: string, userId: string, role: OrgRole): Promise<void>` (throws `LastOwnerError` if it would demote the last owner)
  - `removeMember(orgId: string, userId: string): Promise<void>` (throws `LastOwnerError` if last owner)
  - `addMembership(orgId: string, userId: string, role: OrgRole): Promise<Membership>`
  - `class LastOwnerError extends Error`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import {
  slugify, createOrg, getMembership, setMemberRole, removeMember,
  addMembership, listMembersOfOrg, LastOwnerError,
} from '@/lib/services/orgs';

beforeAll(() => setupTestDb());
afterAll(async () => { await getDb().$disconnect(); });

async function mkUser(name: string) {
  return getDb().user.create({ data: { username: name, passwordHash: 'x', role: 'user' } });
}

describe('orgs service', () => {
  it('slugifies names', () => {
    expect(slugify('Acme Corp!')).toBe('acme-corp');
    expect(slugify('  Multiple   Spaces ')).toBe('multiple-spaces');
  });

  it('creates an org with a unique slug and an owner membership', async () => {
    const u = await mkUser(`o1_${Date.now()}`);
    const a = await createOrg({ name: 'Dupe', createdById: u.id });
    const b = await createOrg({ name: 'Dupe', createdById: u.id });
    expect(a.slug).toBe('dupe');
    expect(b.slug).toBe('dupe-2');
    const m = await getMembership(u.id, a.id);
    expect(m?.role).toBe('owner');
  });

  it('protects the last owner from demotion/removal', async () => {
    const owner = await mkUser(`ow_${Date.now()}`);
    const org = await createOrg({ name: 'Solo', createdById: owner.id });
    await expect(setMemberRole(org.id, owner.id, 'admin')).rejects.toBeInstanceOf(LastOwnerError);
    await expect(removeMember(org.id, owner.id)).rejects.toBeInstanceOf(LastOwnerError);

    const second = await mkUser(`ow2_${Date.now()}`);
    await addMembership(org.id, second.id, 'owner');
    await setMemberRole(org.id, owner.id, 'admin'); // now allowed, 1 owner remains
    const members = await listMembersOfOrg(org.id);
    expect(members.find((m) => m.userId === owner.id)?.role).toBe('admin');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/orgs-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/services/orgs.ts`**

```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/orgs-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/orgs.ts tests/unit/orgs-service.test.ts
git commit -m "feat(orgs): org + membership service with unique slugs and last-owner guard"
```

### Task 4: Idempotent backfill / default-org bootstrap

**Files:**
- Create: `lib/db/backfill.ts`
- Modify: `lib/db/client.ts` (call backfill once after client init) — or wire into app boot; see Step 3.
- Test: `tests/unit/backfill.test.ts`

**Interfaces:**
- Consumes: `createOrg`, `addMembership` from `lib/services/orgs`.
- Produces: `ensureDefaultOrgAndBackfill(): Promise<{ orgId: string } | null>` — idempotent; returns the default org id, or `null` if there are zero users (fresh install pre-setup, nothing to backfill).
- `DEFAULT_ORG_SLUG = 'default'`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import { ensureDefaultOrgAndBackfill, DEFAULT_ORG_SLUG } from '@/lib/db/backfill';

beforeEach(() => setupTestDb());
afterAll(async () => { await getDb().$disconnect(); });

describe('backfill', () => {
  it('is a no-op on a fresh (userless) DB', async () => {
    expect(await ensureDefaultOrgAndBackfill()).toBeNull();
    expect(await getDb().organization.count()).toBe(0);
  });

  it('migrates a v1-shaped DB into the default org, idempotently', async () => {
    // Seed a v1-shaped install: legacy admin, ownerless network + apikey + audit.
    const admin = await getDb().user.create({
      data: { username: 'legacy', passwordHash: 'h', role: 'admin' },
    });
    await getDb().networkMeta.create({ data: { nwid: 'net1', name: 'n' } });
    await getDb().apiKey.create({
      data: { userId: admin.id, name: 'k', prefix: 'ztk_x', hashedKey: 'hh' },
    });
    await getDb().auditLog.create({
      data: { userId: admin.id, action: 'a', targetType: 't', targetId: 'i' },
    });

    const first = await ensureDefaultOrgAndBackfill();
    const orgId = first!.orgId;

    const org = await getDb().organization.findUnique({ where: { slug: DEFAULT_ORG_SLUG } });
    expect(org?.id).toBe(orgId);
    expect((await getDb().user.findUnique({ where: { id: admin.id } }))?.role).toBe('superadmin');
    expect((await getDb().membership.findUnique({
      where: { userId_orgId: { userId: admin.id, orgId } },
    }))?.role).toBe('owner');
    expect((await getDb().networkMeta.findUnique({ where: { nwid: 'net1' } }))?.orgId).toBe(orgId);
    expect((await getDb().apiKey.findFirst({ where: { userId: admin.id } }))?.orgId).toBe(orgId);
    expect((await getDb().apiKey.findFirst({ where: { userId: admin.id } }))?.role).toBe('owner');
    expect((await getDb().auditLog.findFirst())?.orgId).toBe(orgId);

    // Running again must not create a second org or change anything.
    const second = await ensureDefaultOrgAndBackfill();
    expect(second!.orgId).toBe(orgId);
    expect(await getDb().organization.count()).toBe(1);
    expect(await getDb().membership.count()).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/backfill.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/db/backfill.ts`**

```ts
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
```

Wiring: call `ensureDefaultOrgAndBackfill()` once at server startup. Add it to the existing app bootstrap path (the same place controller reconciliation/retention is triggered). If no explicit bootstrap module exists, create `lib/db/bootstrap.ts` exporting a memoized `runStartupTasks()` that awaits `ensureDefaultOrgAndBackfill()` and is invoked from `app/layout.tsx` server component (guard with a module-level promise so it runs once). Do NOT run it inside `getDb()` (keeps the client hot-path pure).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/backfill.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/db/backfill.ts lib/db/bootstrap.ts app/layout.tsx tests/unit/backfill.test.ts
git commit -m "feat(db): idempotent default-org backfill for existing single-admin installs"
```

### Task 5: First-run setup creates a super-admin + default org

**Files:**
- Modify: `app/api/v1/setup/route.ts`
- Modify: `lib/services/auth.ts` (`createUser` gains optional instance role)
- Test: `tests/integration/setup-auth-routes.test.ts` (extend)

**Interfaces:**
- Consumes: `createOrg` (orgs service), `ensureDefaultOrgAndBackfill`.
- Produces: after setup, exactly one org (slug `default`), the new user with `role: 'superadmin'` and an `owner` membership. `createUser(username, password, role?: InstanceRole)`.

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/setup-auth-routes.test.ts`:

```ts
it('setup creates a super-admin who owns a fresh default org', async () => {
  const res = await setupPost(
    new Request('http://x/api/v1/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'root', password: 'password12345' }),
    }),
  );
  expect(res.status).toBe(201);
  const user = await getDb().user.findUnique({ where: { username: 'root' } });
  expect(user?.role).toBe('superadmin');
  const org = await getDb().organization.findUnique({ where: { slug: 'default' } });
  expect(org).not.toBeNull();
  expect((await getDb().membership.findUnique({
    where: { userId_orgId: { userId: user!.id, orgId: org!.id } },
  }))?.role).toBe('owner');
});
```

(Import `POST as setupPost` and `getDb` at the top if not already present; ensure `setupTestDb()` runs in `beforeEach`/`beforeAll` for a clean DB.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/integration/setup-auth-routes.test.ts`
Expected: FAIL — user role is `"user"`, no org created.

- [ ] **Step 3: Implement**

In `lib/services/auth.ts`, widen `createUser`:

```ts
import type { InstanceRole } from '@/lib/authz/roles';

export async function createUser(
  username: string,
  password: string,
  role: InstanceRole = 'user',
): Promise<User> {
  const passwordHash = await hashPassword(password);
  return getDb().user.create({ data: { username, passwordHash, role } });
}
```

In `app/api/v1/setup/route.ts`, after `userCount() > 0` guard, create the super-admin and default org:

```ts
import { createOrg } from '@/lib/services/orgs';
// ...
const user = await createUser(body.username, body.password, 'superadmin');
await createOrg({ name: 'Default', createdById: user.id }); // slug => "default"; creator = owner
const session = await createSession(user.id);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/integration/setup-auth-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/setup/route.ts lib/services/auth.ts tests/integration/setup-auth-routes.test.ts
git commit -m "feat(setup): first-run user is a super-admin owning a default org"
```

---

## Phase 2 — Authorization core (policy + AuthContext + org-scoped accessors)

Wires enforcement into every existing route. After Phase 2 the single default org is correctly role-gated and cross-org isolation holds. This is the security-critical phase: the policy module and scoped accessors are the two structural guarantees.

### Task 6: Policy module

**Files:**
- Create: `lib/authz/policy.ts`
- Test: `tests/unit/policy.test.ts`

**Interfaces:**
- Consumes: `OrgRole`, `ROLE_RANK` from `lib/authz/roles`.
- Produces: `type Action` (union below); `can(role: OrgRole, action: Action): boolean`; `ACTION_MIN_RANK: Record<Action, OrgRole>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { can } from '@/lib/authz/policy';
import { ORG_ROLES } from '@/lib/authz/roles';

describe('policy', () => {
  it('viewers can only read', () => {
    expect(can('viewer', 'network:read')).toBe(true);
    expect(can('viewer', 'network:write')).toBe(false);
    expect(can('viewer', 'member:read')).toBe(true);
  });
  it('editors write networks/members/rules/templates but not org membership', () => {
    expect(can('editor', 'network:write')).toBe(true);
    expect(can('editor', 'rules:write')).toBe(true);
    expect(can('editor', 'template:write')).toBe(true);
    expect(can('editor', 'org:manage-members')).toBe(false);
    expect(can('editor', 'webhook:manage')).toBe(false);
    expect(can('editor', 'apikey:manage')).toBe(false);
  });
  it('admins manage members, webhooks, org api keys; not org rename/delete', () => {
    expect(can('admin', 'org:manage-members')).toBe(true);
    expect(can('admin', 'webhook:manage')).toBe(true);
    expect(can('admin', 'apikey:manage')).toBe(true);
    expect(can('admin', 'org:manage')).toBe(false);
    expect(can('admin', 'org:delete')).toBe(false);
  });
  it('only owners rename/delete/transfer the org', () => {
    expect(can('owner', 'org:manage')).toBe(true);
    expect(can('owner', 'org:delete')).toBe(true);
  });
  it('every role can read the org it belongs to', () => {
    for (const r of ORG_ROLES) expect(can(r, 'org:read')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/policy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/authz/policy.ts`**

```ts
import { ROLE_RANK, type OrgRole } from './roles';

export type Action =
  | 'org:read'
  | 'network:read'
  | 'network:write'
  | 'member:read'
  | 'member:write'
  | 'rules:write'
  | 'template:read'
  | 'template:write'
  | 'org:manage-members'
  | 'webhook:manage'
  | 'apikey:manage'
  | 'org:manage'
  | 'org:delete';

// Minimum org role required for each action. can() is a rank comparison.
export const ACTION_MIN_RANK: Record<Action, OrgRole> = {
  'org:read': 'viewer',
  'network:read': 'viewer',
  'member:read': 'viewer',
  'template:read': 'viewer',
  'network:write': 'editor',
  'member:write': 'editor',
  'rules:write': 'editor',
  'template:write': 'editor',
  'org:manage-members': 'admin',
  'webhook:manage': 'admin',
  'apikey:manage': 'admin',
  'org:manage': 'owner',
  'org:delete': 'owner',
};

export function can(role: OrgRole, action: Action): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[ACTION_MIN_RANK[action]];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/policy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/authz/policy.ts tests/unit/policy.test.ts
git commit -m "feat(authz): pure policy module (can(role, action)) with full matrix"
```

### Task 7: AuthContext resolution — `requireOrgRole` / `requireSuperAdmin`

**Files:**
- Modify: `lib/services/apiKeys.ts` (add `verifyApiKeyWithRecord`)
- Modify: `lib/api/auth.ts` (add `resolveAuth`; keep `requireAuth` delegating)
- Create: `lib/api/authz.ts`
- Test: `tests/integration/authz.test.ts`

**Interfaces:**
- Consumes: `getSession` (returns `Session & {user}`, includes `activeOrgId`), `verifyApiKeyWithRecord`, `getMembership`, `listMembershipsForUser`, `can`, `Action`.
- Produces:
  - `verifyApiKeyWithRecord(fullKey): Promise<{ user: User; apiKey: ApiKey } | null>`
  - `resolveAuth(req): Promise<{ user: User; via: 'session'; session: Session } | { user: User; via: 'apikey'; apiKey: ApiKey } | null>`
  - `interface AuthContext { user: User; isSuperAdmin: boolean; orgId: string | null; role: OrgRole | null; }`
  - `requireOrgRole(req: Request, action: Action, opts?: { orgId?: string }): Promise<AuthContext | Response>`
  - `requireSuperAdmin(req: Request): Promise<AuthContext | Response>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import { createUser, createSession, SESSION_COOKIE } from '@/lib/services/auth';
import { createOrg, addMembership } from '@/lib/services/orgs';
import { createApiKey } from '@/lib/services/apiKeys';
import { requireOrgRole, requireSuperAdmin } from '@/lib/api/authz';

beforeAll(() => setupTestDb());
afterAll(async () => { await getDb().$disconnect(); });

function cookieReq(cookie: string) {
  return new Request('http://x', { headers: { cookie } });
}

describe('requireOrgRole', () => {
  it('403s a viewer attempting a write; allows a read', async () => {
    const u = await createUser(`v_${Date.now()}`, 'password12345');
    const org = await createOrg({ name: 'V', createdById: u.id }); // u is owner
    await getDb().membership.update({
      where: { userId_orgId: { userId: u.id, orgId: org.id } },
      data: { role: 'viewer' },
    });
    const s = await createSession(u.id);
    await getDb().session.update({ where: { id: s.id }, data: { activeOrgId: org.id } });
    const cookie = `${SESSION_COOKIE}=${s.id}`;

    const write = await requireOrgRole(cookieReq(cookie), 'network:write');
    expect(write instanceof Response && write.status).toBe(403);

    const read = await requireOrgRole(cookieReq(cookie), 'network:read');
    expect(read).not.toBeInstanceOf(Response);
    if (!(read instanceof Response)) {
      expect(read.orgId).toBe(org.id);
      expect(read.role).toBe('viewer');
    }
  });

  it('super-admin passes any org action and requireSuperAdmin', async () => {
    const su = await createUser(`su_${Date.now()}`, 'password12345');
    await getDb().user.update({ where: { id: su.id }, data: { role: 'superadmin' } });
    const org = await createOrg({ name: 'S', createdById: su.id });
    const s = await createSession(su.id);
    await getDb().session.update({ where: { id: s.id }, data: { activeOrgId: org.id } });
    const cookie = `${SESSION_COOKIE}=${s.id}`;

    const w = await requireOrgRole(cookieReq(cookie), 'org:delete');
    expect(w).not.toBeInstanceOf(Response);
    const sup = await requireSuperAdmin(cookieReq(cookie));
    expect(sup).not.toBeInstanceOf(Response);
  });

  it('requireSuperAdmin 403s a non-super-admin', async () => {
    const u = await createUser(`n_${Date.now()}`, 'password12345');
    await createOrg({ name: 'N', createdById: u.id });
    const s = await createSession(u.id);
    const res = await requireSuperAdmin(cookieReq(`${SESSION_COOKIE}=${s.id}`));
    expect(res instanceof Response && res.status).toBe(403);
  });

  it('an API key acts with its own org + role', async () => {
    const u = await createUser(`k_${Date.now()}`, 'password12345');
    const org = await createOrg({ name: 'K', createdById: u.id });
    const { fullKey } = await createApiKey(u.id, 'k', undefined, { orgId: org.id, role: 'viewer' });
    const req = new Request('http://x', { headers: { authorization: `Bearer ${fullKey}` } });
    const write = await requireOrgRole(req, 'network:write');
    expect(write instanceof Response && write.status).toBe(403);
    const read = await requireOrgRole(req, 'network:read');
    expect(read).not.toBeInstanceOf(Response);
  });
});
```

Note: this test consumes the extended `createApiKey` signature from Task 18; if implementing strictly in order, stub the 4th arg now (accept and ignore) and finish it in Task 18, or implement Task 18's `createApiKey` change here. Recommended: make the `createApiKey` options change (Task 18 Step 3) as part of this task's Step 3 since `requireOrgRole` depends on `ApiKey.orgId`/`role` being populated.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/integration/authz.test.ts`
Expected: FAIL — `lib/api/authz` not found.

- [ ] **Step 3: Implement**

In `lib/services/apiKeys.ts` add (and set org/role on create):

```ts
import type { ApiKey } from '@prisma/client';
import type { OrgRole } from '@/lib/authz/roles';

export async function verifyApiKeyWithRecord(
  fullKey: string,
): Promise<{ user: User; apiKey: ApiKey } | null> {
  const hashedKey = createHash('sha256').update(fullKey).digest('hex');
  const row = await getDb().apiKey.findUnique({ where: { hashedKey }, include: { user: true } });
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
  await getDb().apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  const { user, ...apiKey } = row;
  return { user, apiKey };
}
```

Update `createApiKey` to accept `scope?: { orgId: string | null; role: OrgRole | null }` and persist `orgId`/`role` (default both `null`). Keep `verifyApiKey` delegating to `verifyApiKeyWithRecord` for `lib/api/auth.ts` back-compat:

```ts
export async function verifyApiKey(fullKey: string): Promise<User | null> {
  return (await verifyApiKeyWithRecord(fullKey))?.user ?? null;
}
```

In `lib/api/auth.ts` add `resolveAuth` (extract the token/cookie parsing there) returning the richer union; keep `requireAuth` returning `{ user }` by delegating to `resolveAuth`.

Create `lib/api/authz.ts`:

```ts
import type { User } from '@prisma/client';
import { apiError } from './errors';
import { resolveAuth } from './auth';
import { getMembership, listMembershipsForUser } from '@/lib/services/orgs';
import { can, type Action } from '@/lib/authz/policy';
import { isOrgRole, type OrgRole } from '@/lib/authz/roles';

export interface AuthContext {
  user: User;
  isSuperAdmin: boolean;
  orgId: string | null;
  role: OrgRole | null;
}

async function resolveActiveOrg(
  auth: Awaited<ReturnType<typeof resolveAuth>>,
  requestedOrgId?: string,
): Promise<{ orgId: string | null; role: OrgRole | null }> {
  if (!auth) return { orgId: null, role: null };
  if (auth.via === 'apikey') {
    const role = auth.apiKey.role && isOrgRole(auth.apiKey.role) ? auth.apiKey.role : null;
    return { orgId: auth.apiKey.orgId, role };
  }
  // session
  let orgId = requestedOrgId ?? auth.session.activeOrgId ?? null;
  if (!orgId) {
    const first = (await listMembershipsForUser(auth.user.id))[0];
    orgId = first?.orgId ?? null;
  }
  if (!orgId) return { orgId: null, role: null };
  const m = await getMembership(auth.user.id, orgId);
  return { orgId, role: m && isOrgRole(m.role) ? m.role : null };
}

export async function requireOrgRole(
  req: Request,
  action: Action,
  opts?: { orgId?: string },
): Promise<AuthContext | Response> {
  const auth = await resolveAuth(req);
  if (!auth) return apiError('UNAUTHORIZED', 'Authentication required.', 401);
  const isSuperAdmin = auth.user.role === 'superadmin';
  const { orgId, role } = await resolveActiveOrg(auth, opts?.orgId);

  if (isSuperAdmin) {
    // Super-admin may act in any org; still needs a resolved org to scope queries.
    if (!orgId && opts?.orgId) return ctx(auth.user, true, opts.orgId, 'owner');
    if (!orgId) return apiError('NO_ACTIVE_ORG', 'Select an organization first.', 400);
    return ctx(auth.user, true, orgId, 'owner');
  }
  if (!orgId || !role) return apiError('FORBIDDEN', 'No access to any organization.', 403);
  if (opts?.orgId && opts.orgId !== orgId) {
    return apiError('FORBIDDEN', 'Not a member of this organization.', 403);
  }
  if (!can(role, action)) return apiError('FORBIDDEN', 'Insufficient role.', 403);
  return ctx(auth.user, false, orgId, role);
}

export async function requireSuperAdmin(req: Request): Promise<AuthContext | Response> {
  const auth = await resolveAuth(req);
  if (!auth) return apiError('UNAUTHORIZED', 'Authentication required.', 401);
  if (auth.user.role !== 'superadmin') {
    return apiError('FORBIDDEN', 'Super-admin required.', 403);
  }
  return ctx(auth.user, true, null, null);
}

function ctx(user: User, isSuperAdmin: boolean, orgId: string | null, role: OrgRole | null): AuthContext {
  return { user, isSuperAdmin, orgId, role };
}
```

Note on `opts.orgId`: routes under `/orgs/{orgId}/…` pass the path org so a super-admin (or member) is scoped to that exact org; routes without an org in the path (e.g. `/networks`) rely on the session's active org.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/integration/authz.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/api/authz.ts lib/api/auth.ts lib/services/apiKeys.ts tests/integration/authz.test.ts
git commit -m "feat(authz): AuthContext resolution with requireOrgRole/requireSuperAdmin"
```

### Task 8: Org-scoped data accessors (the isolation backstop)

**Files:**
- Modify: `lib/services/networks.ts` (add `*ForOrg` accessors; `createNetwork` writes `orgId`)
- Modify: `lib/services/templates.ts` (org-scoped list/get/create)
- Modify: `lib/services/audit.ts` (`logAudit` gains `orgId`; `listAuditLogForOrg`)
- Modify: `lib/services/webhooks.ts` (org-prefixed setting keys)
- Test: `tests/unit/org-scoped-accessors.test.ts`

**Interfaces:**
- Produces:
  - `listNetworksForOrg(orgId: string): Promise<NetworkSummary[]>` — only nwids whose `NetworkMeta.orgId === orgId`.
  - `getNetworkForOrg(nwid: string, orgId: string): Promise<NetworkDetail | null>` — null if the network's `NetworkMeta.orgId !== orgId` (even when the controller knows it).
  - `createNetwork(input, orgId: string)` — sets `NetworkMeta.orgId`.
  - `assertNetworkInOrg(nwid: string, orgId: string): Promise<boolean>` — used by member/rules routes to gate by parent network.
  - `listUnassignedNetworks(): Promise<NetworkSummary[]>` (super-admin orphan view).
  - `logAudit({ ..., orgId?: string | null })`; `listAuditLogForOrg(orgId: string, limit?)`.
  - templates: `listTemplatesForOrg(orgId)`, `getTemplateForOrg(id, orgId)`, `createTemplate(input, orgId)`.
  - webhooks: `getWebhookConfig(orgId)`, `setWebhookConfig(orgId, cfg)` keyed `webhook:{orgId}`.

- [ ] **Step 1: Write the failing test** (cross-org isolation is the key assertion)

```ts
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
vi.mock('@/lib/controller', () => ({ getControllerClient: vi.fn() }));
import { getControllerClient } from '@/lib/controller';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import { listNetworksForOrg, getNetworkForOrg, assertNetworkInOrg } from '@/lib/services/networks';

const NET = { id: 'aaaa000000000001', name: 'x', private: true, /* …minimal ControllerNetwork… */ } as any;
const client = {
  listNetworkIds: vi.fn().mockResolvedValue(['aaaa000000000001', 'bbbb000000000002']),
  getNetwork: vi.fn().mockResolvedValue(NET),
  listMemberIds: vi.fn().mockResolvedValue({}),
};

beforeEach(async () => {
  setupTestDb();
  vi.clearAllMocks();
  (getControllerClient as any).mockResolvedValue(client);
});
afterAll(async () => { await getDb().$disconnect(); });

it('lists only the org’s networks and blocks cross-org fetch', async () => {
  await getDb().networkMeta.create({ data: { nwid: 'aaaa000000000001', orgId: 'orgA' } });
  await getDb().networkMeta.create({ data: { nwid: 'bbbb000000000002', orgId: 'orgB' } });

  const listed = await listNetworksForOrg('orgA');
  expect(listed.map((n) => n.nwid)).toEqual(['aaaa000000000001']);

  expect(await getNetworkForOrg('aaaa000000000001', 'orgA')).not.toBeNull();
  expect(await getNetworkForOrg('aaaa000000000001', 'orgB')).toBeNull(); // cross-org denied
  expect(await assertNetworkInOrg('bbbb000000000002', 'orgA')).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/org-scoped-accessors.test.ts`
Expected: FAIL — accessors not defined.

- [ ] **Step 3: Implement the accessors** in `lib/services/networks.ts`:

```ts
export async function listNetworksForOrg(orgId: string): Promise<NetworkSummary[]> {
  const client = await getControllerClient();
  const ids = await client.listNetworkIds();
  const metas = await getDb().networkMeta.findMany({ where: { nwid: { in: ids }, orgId } });
  const owned = new Set(metas.map((m) => m.nwid));
  const metaMap = new Map(metas.map((m) => [m.nwid, m]));
  return Promise.all(
    ids.filter((nwid) => owned.has(nwid)).map(async (nwid) => {
      const [config, memberIds] = await Promise.all([
        client.getNetwork(nwid),
        client.listMemberIds(nwid),
      ]);
      const meta = metaMap.get(nwid);
      return {
        nwid,
        name: meta?.name || config.name || nwid,
        description: meta?.description ?? '',
        tags: meta ? (JSON.parse(meta.tags) as string[]) : [],
        private: config.private,
        memberCount: Object.keys(memberIds).length,
      };
    }),
  );
}

export async function assertNetworkInOrg(nwid: string, orgId: string): Promise<boolean> {
  const meta = await getDb().networkMeta.findUnique({ where: { nwid } });
  return meta?.orgId === orgId;
}

export async function getNetworkForOrg(nwid: string, orgId: string): Promise<NetworkDetail | null> {
  if (!(await assertNetworkInOrg(nwid, orgId))) return null;
  return getNetwork(nwid); // existing controller fetch + toDetail
}

export async function listUnassignedNetworks(): Promise<NetworkSummary[]> {
  const client = await getControllerClient();
  const ids = await client.listNetworkIds();
  const metas = await getDb().networkMeta.findMany({ where: { nwid: { in: ids } } });
  const assigned = new Set(metas.filter((m) => m.orgId).map((m) => m.nwid));
  const orphanIds = ids.filter((nwid) => !assigned.has(nwid));
  // …same summary mapping as above for orphanIds…
  return Promise.all(orphanIds.map(/* summary mapper */));
}
```

Change `createNetwork(input: CreateNetworkInput, orgId: string)` to set `orgId` in both the `create` and `update` branches of the `networkMeta.upsert`. Apply the same `orgId` argument to `createNetworkFromConfig` / `cloneNetwork` (thread `orgId` through; clone reads the source's org and must equal the caller's org — the route enforces this).

In `lib/services/audit.ts`, add `orgId?: string | null` to `logAudit` input and persist it; add:

```ts
export async function listAuditLogForOrg(orgId: string, limit = 100): Promise<AuditEntry[]> {
  const take = Math.min(Math.max(limit, 1), 500);
  const rows = await getDb().auditLog.findMany({
    where: { orgId },
    take,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { user: { select: { username: true } } },
  });
  return rows.map(/* same mapping as listAuditLog */);
}
```

In `lib/services/templates.ts`, add `orgId` filter to list/get and set it on create; enforce name-uniqueness per org in `createTemplate` (findFirst by `{ orgId, name }` → throw a `TemplateNameTakenError` mapped to 409). In `lib/services/webhooks.ts`, key the stored `Setting` by `webhook:{orgId}` instead of a single global key; `getWebhookConfig(orgId)`/`setWebhookConfig(orgId, cfg)`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/org-scoped-accessors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/networks.ts lib/services/templates.ts lib/services/audit.ts lib/services/webhooks.ts tests/unit/org-scoped-accessors.test.ts
git commit -m "feat(authz): org-scoped data accessors as the tenant-isolation backstop"
```

### Task 9: Wire enforcement into every existing route (fully worked example + enumeration)

This task converts each existing route from `requireAuth` to `requireOrgRole(action)` (org-owned) or `requireSuperAdmin` (instance-global), routes reads/writes through the `*ForOrg` accessors, and passes `orgId` to `logAudit`. Do them one file at a time, each with its own test update + commit — but the transformation is identical, so it is fully specified once here and enumerated per file.

**The transformation (worked example: `app/api/v1/networks/route.ts`):**

- [ ] **Step 1: Update the route's test first** — add role + isolation cases. For `tests/integration/networks-routes.test.ts`, extend `createTestUserAndSession` usage so the session has an `activeOrgId` (see Task 9a helper below), then add:

```ts
it('403s an editor-less (viewer) session on POST', async () => {
  const { cookie } = await createTestUserAndSession({ role: 'viewer' });
  const res = await createPost(new Request('http://x/api/v1/networks', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: '{}',
  }));
  expect(res.status).toBe(403);
});

it('GET /networks lists only the active org’s networks', async () => {
  // NWID meta belongs to the test user’s org; a second org’s network is filtered out.
  const res = await listGet(req('http://x/api/v1/networks', 'GET'));
  const body = await res.json();
  expect(body.networks.every((n: any) => n.nwid === NWID)).toBe(true);
});
```

- [ ] **Step 2: Run to verify the new cases fail**

Run: `npx vitest run tests/integration/networks-routes.test.ts`
Expected: FAIL — writes still succeed for viewers; listing not org-filtered.

- [ ] **Step 3: Transform the route.** Replace `requireAuth` and the bare service call:

```ts
import { requireOrgRole } from '@/lib/api/authz';
// ...
export async function GET(req: Request) {
  const auth = await requireOrgRole(req, 'network:read');
  if (auth instanceof Response) return auth;
  try {
    return NextResponse.json({ networks: await listNetworksForOrg(auth.orgId!) });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function POST(req: Request) {
  const auth = await requireOrgRole(req, 'network:write');
  if (auth instanceof Response) return auth;
  try {
    const body = createNetworkSchema.parse(await req.json());
    const { data, metaWarning } = await createNetwork(body, auth.orgId!);
    await logAudit({
      userId: auth.user.id,
      orgId: auth.orgId,
      action: 'network.create',
      targetType: 'network',
      targetId: data.nwid,
      detail: body,
    });
    return NextResponse.json({ network: data, metaWarning }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/integration/networks-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**, then repeat Steps 1–5 for each remaining file below.

**Enumeration — apply the identical pattern (action in parentheses; use `getNetworkForOrg`/`assertNetworkInOrg` for anything under a network; pass `orgId` to `logAudit`):**

| Route file | Reads → action | Writes → action | Scoping call |
|---|---|---|---|
| `app/api/v1/networks/[nwid]/route.ts` | GET → `network:read` | PATCH → `network:write`, DELETE → `network:write` | `getNetworkForOrg(nwid, orgId)`; 404 if null |
| `app/api/v1/networks/[nwid]/members/route.ts` | GET → `member:read` | — | gate: `assertNetworkInOrg(nwid, orgId)` else 404 |
| `app/api/v1/networks/[nwid]/members/[memberId]/route.ts` | GET → `member:read` | PATCH/DELETE → `member:write` | `assertNetworkInOrg` gate |
| `app/api/v1/networks/[nwid]/rules/route.ts` | GET → `network:read` | PUT → `rules:write` | `assertNetworkInOrg` gate |
| `app/api/v1/networks/[nwid]/clone/route.ts` | — | → `network:write` | `assertNetworkInOrg(source, orgId)`; clone into same org |
| `app/api/v1/networks/[nwid]/presence/route.ts` | GET → `network:read` | — | `assertNetworkInOrg` gate |
| `app/api/v1/templates/route.ts` | GET → `template:read` | POST → `template:write` | `*TemplatesForOrg(orgId)` |
| `app/api/v1/templates/[id]/route.ts` | GET → `template:read` | PATCH → `template:write` | `getTemplateForOrg(id, orgId)` |
| `app/api/v1/templates/[id]/apply/route.ts` | — | → `network:write` | create into `orgId` |
| `app/api/v1/settings/webhook/route.ts` | GET → `webhook:manage` | POST → `webhook:manage` | `*WebhookConfig(orgId)` |
| `app/api/v1/audit/route.ts` | GET → `org:read` | — | `listAuditLogForOrg(orgId)` |
| `app/api/v1/pending/route.ts` | GET → `member:read` | — | filter to org’s networks |
| `app/api/v1/apikeys/*` | GET → `apikey:manage` | POST/DELETE → `apikey:manage` | list/scope by `orgId` (Task 18 refines create) |

**Instance-global → `requireSuperAdmin(req)` (no org scoping):**

| Route file |
|---|
| `app/api/v1/controller/status/route.ts` |
| `app/api/v1/metrics/route.ts` |
| `app/api/v1/backup/route.ts` |
| `app/api/v1/backup/restore/route.ts` |

**`app/api/v1/me/route.ts`** — keep `requireAuth`; extend the response with memberships + active org + `isSuperAdmin` (Task 10 covers the shape).

- [ ] **Task 9a (helper): extend the test auth helper.** Modify `tests/helpers/auth.ts` so tests get a member with a role in a real org and an active-org session:

```ts
import type { User } from '@prisma/client';
import { createSession, createUser, SESSION_COOKIE } from '@/lib/services/auth';
import { createOrg, setMemberRole } from '@/lib/services/orgs';
import { getDb } from '@/lib/db/client';
import type { OrgRole } from '@/lib/authz/roles';

let counter = 0;

export async function createTestUserAndSession(
  opts: { role?: OrgRole; superadmin?: boolean } = {},
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
```

Existing callers that ignore the new fields keep working (default role = owner, full access), so pre-existing route tests stay green after their scoping updates.

- [ ] **Final step of Task 9: full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS across all migrated routes. Commit any remaining route with `git commit -m "feat(authz): enforce roles + org scoping on <route>"`.

---

## Phase 3 — Organization management, membership & roles (API + UI)

Adds the org CRUD, membership management, org-switcher, and super-admin surfaces. Each task follows the same TDD rhythm and the route pattern fully worked in Task 9 (write test → fail → `requireOrgRole`/`requireSuperAdmin` handler + zod schema + `logAudit` → pass → commit).

### Task 10: `GET /me` returns memberships + active org; `POST /orgs/{orgId}/active`

**Files:** Modify `app/api/v1/me/route.ts`; Create `app/api/v1/orgs/[orgId]/active/route.ts`; Test `tests/integration/me-active-org.test.ts`.

**Interfaces:**
- Produces `GET /me` body: `{ user: { id, username, role, totpEnabled, isSuperAdmin }, activeOrgId, memberships: { orgId, orgName, orgSlug, role }[] }`.
- `POST /orgs/{orgId}/active` — sets `Session.activeOrgId` (must be a member or super-admin); returns 204. Only valid for cookie sessions (API keys are org-bound already → 400 for API-key callers).

Key code: resolve session id from the cookie (reuse `resolveAuth`), verify membership via `getMembership` (or super-admin), `getDb().session.update({ where: { id }, data: { activeOrgId } })`. Test: switching to a non-member org → 403; to a member org → 204 and subsequent `/networks` reflects it.

### Task 11: Org CRUD — `GET/POST /orgs`, `GET/PATCH/DELETE /orgs/{orgId}`

**Files:** Create `app/api/v1/orgs/route.ts`, `app/api/v1/orgs/[orgId]/route.ts`; service additions in `lib/services/orgs.ts` (`renameOrg`, `deleteOrg`); Test `tests/integration/orgs-routes.test.ts`.

**Interfaces / rules:**
- `GET /orgs` — members: their orgs (`listMembershipsForUser`); super-admin: all orgs. Body `{ orgs: { id, name, slug, role }[] }`.
- `POST /orgs` — **super-admin only** (`requireSuperAdmin`); zod `{ name: string(1..60) }`; `createOrg({ name, createdById: user.id })`; audit `org.create`.
- `PATCH /orgs/{orgId}` — `requireOrgRole(req, 'org:manage', { orgId })`; rename (regenerates nothing — slug is stable); audit `org.update`.
- `DELETE /orgs/{orgId}` — `requireOrgRole(req, 'org:delete', { orgId })`; **guard:** refuse (409 `ORG_NOT_EMPTY`) if any `NetworkMeta.orgId === orgId` exists — owner must reassign/delete networks first. On success cascade removes memberships/invitations (FK `onDelete: Cascade`); audit `org.delete`.

`deleteOrg(orgId)` in the service throws `OrgNotEmptyError` when networks remain; the route maps it to 409.

### Task 12: Membership management — `GET/POST/PATCH/DELETE /orgs/{orgId}/members*`

**Files:** Create `app/api/v1/orgs/[orgId]/members/route.ts`, `app/api/v1/orgs/[orgId]/members/[userId]/route.ts`; Test `tests/integration/org-members-routes.test.ts`.

**Interfaces / rules:**
- `GET` — `requireOrgRole(req, 'org:read', { orgId })`; returns `listMembersOfOrg(orgId)` mapped to `{ userId, username, role }`. **Super-admin visibility rule:** super-admins who are not explicit members are appended to the list ONLY when the caller is an owner/admin or a super-admin; editors/viewers never see them (see spec §4). Implement a `visibleMembers(orgId, caller)` helper.
- `POST` (direct-create) — `requireOrgRole(req, 'org:manage-members', { orgId })`; zod `{ username(3..32), password(10..128), role: OrgRole }`; `createUser` + `addMembership`; audit `member.create`. 409 if username taken.
- `PATCH /{userId}` — `requireOrgRole(req, 'org:manage-members', { orgId })`; zod `{ role: OrgRole }`; `setMemberRole` (maps `LastOwnerError` → 409 `LAST_OWNER`). Only owners may grant/revoke `owner` (admins can set editor/viewer/admin but not owner) — enforce with an explicit check.
- `DELETE /{userId}` — `requireOrgRole(req, 'org:manage-members', { orgId })`; `removeMember` (maps `LastOwnerError` → 409); audit `member.remove`.

### Task 13: App-shell org switcher (UI)

**Files:** Create `components/OrgSwitcher.tsx`; Modify the app shell/layout that renders nav (follow the existing nav component added with `/account`); Test `tests/ui/org-switcher.test.tsx`.

**Behavior:** fetches `/me`, renders a dropdown of memberships (current = `activeOrgId`); on change `POST /orgs/{id}/active` then invalidates TanStack Query caches / reloads network data. Hidden when the user has a single membership and is not a super-admin. Follow existing component conventions (`clsx`, Tailwind tokens, `@testing-library/react` patterns as in `tests/ui/account-page.test.tsx`).

### Task 14: Members & roles page (UI)

**Files:** Create `app/(ui)/orgs/[orgId]/members/page.tsx` and `components/OrgMembers.tsx`; Test `tests/ui/org-members.test.tsx`.

**Behavior:** table of members with role `<select>` (disabled unless caller can `org:manage-members`), remove button (guarded), and a "Add member" form (direct-create). Wire to Task 12 endpoints. Show the invitations panel (Task 17) as a section. Role badges reuse existing badge styling. Mirror the mocked-fetch UI test pattern already in the repo.

### Task 15: Super-admin area (UI) — org list + create/delete

**Files:** Create `app/(ui)/admin/page.tsx` and `components/AdminOrgs.tsx`; Test `tests/ui/admin-orgs.test.tsx`.

**Behavior:** visible only when `/me` reports `isSuperAdmin`; lists all orgs (`GET /orgs`), create-org form (`POST /orgs`), delete (with the not-empty guard surfaced as an inline error). Link the existing instance concerns (controller status, backups, metrics pages) here and gate their nav entries on `isSuperAdmin`.

---

## Phase 4 — Invitations, direct-create polish & org-scoped API keys

### Task 16: Invitation service + endpoints

**Files:** Create `lib/services/invitations.ts`; Create `app/api/v1/orgs/[orgId]/invitations/route.ts`, `app/api/v1/orgs/[orgId]/invitations/[id]/route.ts`, `app/api/v1/invitations/[token]/route.ts`, `app/api/v1/invitations/[token]/accept/route.ts`; Test `tests/unit/invitations-service.test.ts`, `tests/integration/invitations-routes.test.ts`.

**Interfaces / rules (mirror the API-key hashed-token pattern in `lib/services/apiKeys.ts`):**
- `generateInvitationToken(): { token, hashedToken }` — `token = inv_<hex>`; store only the SHA-256 hash.
- `createInvitation({ orgId, role, email?, createdById, ttlMs })` → returns `{ invitation, token }` (token shown once).
- `getInvitationByToken(token)` → validates not expired / not accepted; returns `{ orgId, orgName, role }` for preview.
- `acceptInvitation({ token, username, password })` → creates the user (instance role `user`) + membership with the invite's role, marks `acceptedAt`, opens a session; single-use (idempotency: reject if already accepted).
- Routes: create/list/revoke require `requireOrgRole(req, 'org:manage-members', { orgId })`; `GET /invitations/{token}` and `POST /invitations/{token}/accept` are **public** (no auth), rate-limited via the existing `createRateLimiter` (like `/setup`). Accept sets the session cookie exactly as `/setup` does.

**Failing-test seeds:** expired token → 410 `INVITATION_EXPIRED`; reused token → 409 `INVITATION_USED`; valid → creates member with the invited role; wrong-role creator (editor) → 403.

### Task 17: Invitation UI — create panel + public accept page

**Files:** Create `components/OrgInvitations.tsx` (inside the members page) and `app/(ui)/invite/[token]/page.tsx`; Test `tests/ui/invitations.test.tsx`.

**Behavior:** admins create an invite (role + TTL), see the link once with a copy button, and can revoke pending invites. The public `/invite/[token]` page previews org+role (`GET`), collects username/password, and posts accept; on success redirects into the app. Follows the existing auth-page UI pattern (`tests/ui/auth-pages.test.tsx`).

### Task 18: Org-scoped API keys

**Files:** Modify `lib/services/apiKeys.ts` (create/list/delete scoped by org + role — the `createApiKey` scope arg was added in Task 7); Modify `app/api/v1/apikeys/*`; Test `tests/integration/apikeys-routes.test.ts` (extend), `tests/unit/apikeys-service.test.ts` (extend).

**Interfaces / rules:**
- `createApiKey(userId, name, expiresAt?, scope: { orgId: string; role: OrgRole })` — persists `orgId` + `role`; **role capped at the creator's live role** (reject with 403 if `ROLE_RANK[requestedRole] > ROLE_RANK[callerRole]`).
- `listApiKeys(userId, orgId)` — scoped to the active org.
- `deleteApiKey(id, userId, orgId)` — scoped delete.
- `POST /apikeys` — `requireOrgRole(req, 'apikey:manage')`; zod adds `role: OrgRole`; uses `auth.orgId!` + role cap. `GET`/`DELETE` scoped to `auth.orgId!`. Super-admin may still create an instance key (`orgId: null`) via an explicit `{ instance: true }` flag on `requireSuperAdmin` — optional; default org-scoped.

### Task 19: OpenAPI spec regeneration

**Files:** Modify the OpenAPI generation source (`app/api/v1/openapi.json/route.ts` or its backing module — see `tests/unit/openapi.test.ts`); Test `tests/unit/openapi.test.ts` (extend).

**Behavior:** add the new `/orgs*`, `/orgs/{orgId}/members*`, `/orgs/{orgId}/invitations*`, `/invitations/{token}*` paths and the `403 FORBIDDEN` response to the documented error envelope; add `orgId`/`role` to the API-key create schema. Extend the existing openapi test to assert the new paths are present and every non-public path documents `401` and `403`.

### Task 20: Docs — README auth/roles section

**Files:** Modify `README.md` (and any `docs/` operator guide added in v1).

**Behavior:** document the role model (super-admin vs owner/admin/editor/viewer), how the default-org backfill behaves on upgrade, how to create orgs (super-admin), invite links vs direct-create, and note that OIDC/SSO remains a future item unblocked by these seams. No test; commit with `docs:`.

---

## Self-Review

**Spec coverage:**
- §3 data model → Task 1 (all models/columns), Task 2 (roles). ✓
- §4 policy + AuthContext + scoped accessors + API-key scoping + audit orgId → Tasks 6, 7, 8, 18, 8. ✓
- §5 migration/backfill + first-run + orphan guard → Task 4, Task 5, Task 8 (`listUnassignedNetworks`) + Task 11 (delete guard). ✓
- §6 API surface (orgs, members, invitations, changed routes, instance-global, apikeys) → Tasks 9, 10, 11, 12, 16, 18. ✓
- §7 UI (switcher, members page, invite accept, super-admin area, existing pages gated) → Tasks 13, 14, 15, 17 (and role-gating in each). ✓
- §8 OIDC seams (nullable password, Identity table, data-driven roles, invitation email) → Task 1 (schema) + Task 16 (`email`). Verified: nothing writes `Identity` this wave, by design. ✓
- §9 testing (policy exhaustive, scoped accessors, per-route 403 + isolation, migration) → Tasks 6, 8, 9, 4. ✓
- §10 phasing → Phases 1–4 map 1:1. ✓
- §11 resolved questions (org creation super-admin-only, org-prefixed webhook keys, super-admin visibility, slug) → Task 11 (POST /orgs super-admin), Task 8 (webhook keys), Task 12 (visibility), Task 3 (`slugify`+collision). ✓

**Placeholder scan:** No "TBD/TODO". Task 9 uses an enumeration table for identical route transforms rather than repeating code — the transform is fully shown once; each row names the exact file, action, and scoping call. Phase 3–4 tasks give interfaces, rules, and non-obvious code; they intentionally reuse the Task 9 worked pattern rather than restating it.

**Type consistency:** `OrgRole`/`InstanceRole` (Task 2) used consistently; `can(role, action)` + `Action` union (Task 6) match call sites; `createApiKey` scope arg introduced in Task 7 and finalized in Task 18 (flagged inline); `AuthContext.orgId` is `string | null` and routes use `auth.orgId!` only after `requireOrgRole` guarantees it for org actions; `logAudit` `orgId` optional-nullable everywhere.

**Known cross-task dependency (flagged inline):** Task 7's test consumes the extended `createApiKey` scope arg — implement that signature change in Task 7 Step 3, with Task 18 completing the role-cap enforcement and route wiring.
