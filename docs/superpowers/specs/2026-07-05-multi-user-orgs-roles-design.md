# GEM-ZT — Multi-user, Organizations, and Roles — Design

**Status:** Approved (brainstorm) · **Date:** 2026-07-05 · **Backlog:** TODO.md P1 #1
(the v1 deferral, spec §11). Designed so the P2 OIDC/SSO item drops in additively.

## 1. Goal & scope

Turn GEM-ZT from a single-admin controller UI into a multi-tenant system: multiple
users, multiple organizations, and role-based authorization enforced across every
service and API route.

**In scope**

- True multi-tenancy: organizations own their networks/members; data is isolated per org.
- An instance-level **super-admin** role above all orgs.
- Per-org roles: **Owner / Admin / Editor / Viewer**.
- Multi-org membership (a user can belong to several orgs, with an independent role
  in each) + an active-org switcher.
- User onboarding via **invite links (hashed tokens)** and **direct admin create**.
- Authorization enforced with a **thin policy module at the route boundary + mandatory
  org-scoped data accessors** (defense in depth).
- Schema/auth **seams** so a future OIDC/SSO login is additive (no OIDC code built here).
- Idempotent migration of the existing single-admin deployment.

**Out of scope (this wave)**

- OIDC/SSO login button, discovery/callback route, provider config UI (separate P2 item).
- SMTP email delivery of invitations (invite links are shared out-of-band; `email` field
  is reserved for when SMTP lands).
- High availability / multiple controllers.

## 2. Load-bearing decisions

| Decision       | Choice                                                                 |
| -------------- | ---------------------------------------------------------------------- |
| Org model      | True multi-tenancy — orgs own networks/members; per-org isolation      |
| Instance admin | Distinct **super-admin** role above orgs                               |
| Org roles      | Owner / Admin / Editor / Viewer                                        |
| Membership     | Multi-org (org-switcher + per-session active org)                      |
| Provisioning   | Invite links (token) **and** direct admin create                       |
| OIDC           | Schema + auth seams only; no OIDC code this wave                       |
| Enforcement    | Route-boundary policy module **+** mandatory org-scoped data accessors |

## 3. Data model

String-typed enums (consistent with the existing `role` field and SQLite).

### New models

- **`Organization`** — `id`, `name`, `slug` (unique), `createdAt`, `createdById`.
- **`Membership`** (User↔Org join, source of truth for authorization) — `id`, `userId`,
  `orgId`, `role` (`owner`|`admin`|`editor`|`viewer`), `createdAt`,
  `@@unique([userId, orgId])`, index on `orgId`.
- **`Invitation`** — `id`, `orgId`, `role`, `hashedToken` (unique), `createdById`,
  `expiresAt`, `acceptedAt?`, `email?` (reserved for SMTP), `createdAt`. Follows the
  existing hashed-token pattern (API keys / sessions).
- **`Identity`** (OIDC seam) — `id`, `userId`, `provider`, `subject`,
  `@@unique([provider, subject])`. Nothing writes here this wave; a future OIDC callback
  upserts User + Identity with no schema change.

### Changed models

- **`User`** — `passwordHash` becomes **optional** (`String?`); `role` repurposed as the
  **instance** role `superadmin | user`; add relations `memberships`, `identities`.
- **`Session`** — add `activeOrgId String?` (org-switcher context, per session).
- **`NetworkMeta`** — add `orgId` (indexed) — how a global controller network is owned.
- **`ApiKey`** — add `orgId` and `role` (key's effective org role, capped at creator's
  role at creation; super-admin instance keys may have `orgId = null`).
- **`AuditLog`** — add `orgId String?` (null for instance-level actions).
- **`NetworkTemplate`** — add `orgId` (templates become org-scoped).
- **Webhook config** — the current global `Setting` becomes per-org via **org-prefixed
  `Setting` keys** (e.g. `webhook:{orgId}:…`); no new table.

**Ownership derivation:** `MemberMeta` stays keyed by `(nwid, memberId)`; its org is derived
through the parent `NetworkMeta.orgId` — one source of truth per network's org.

## 4. Authorization model (route policy + data backstop)

### AuthContext

`requireAuth()` (returns `{ user }`) is extended to produce an **`AuthContext`**:
`{ user, isSuperAdmin, orgId, role }`, resolving the active org against the caller's
`Membership`.

**Active-org resolution (precedence):**

1. **API key** → the key's own `orgId`/`role` (explicit, immutable per key).
2. **Session** → `Session.activeOrgId`; if null, default to the user's first membership.
   The org-switcher writes `activeOrgId`.
3. **Instance-global routes** (controller, backup, metrics, org CRUD) resolve no org and
   require `isSuperAdmin`.

### Policy module

Pure, unit-tested `can(role, action)` + `canInstance(user, action)`. Actions are a small
enum (`network:read|create|update|delete`, `member:read|authorize|update`, `rules:write`,
`template:*`, `apikey:manage`, `org:manage-members`, `org:delete`, …).

| Action                                                                   | Owner | Admin | Editor | Viewer |
| ------------------------------------------------------------------------ | :---: | :---: | :----: | :----: |
| read networks / members / audit                                          |   ✓   |   ✓   |   ✓    |   ✓    |
| create/update/delete networks, authorize members, write rules, templates |   ✓   |   ✓   |   ✓    |   —    |
| manage org members & roles, invitations, webhooks, org API keys          |   ✓   |   ✓   |   —    |   —    |
| rename/delete org, transfer ownership                                    |   ✓   |   —   |   —    |   —    |

Super-admin passes every check, may act in any org, and holds instance-only actions.

### Enforcement (defense in depth — "C")

- **Route boundary:** each handler calls `requireOrgRole(req, action)` → `403 FORBIDDEN`
  or `AuthContext`. One line per route; clear, testable.
- **Data-layer backstop:** org-owned reads/writes go through scoped accessors that
  **require** an `orgId` argument (e.g. `getNetworkForOrg(nwid, orgId)`); the controller's
  global network list is filtered to nwids whose `NetworkMeta.orgId` matches. A handler
  physically cannot fetch a network without an org scope, so a forgotten role check can't
  leak another org's data. Super-admin uses an explicit `*`-scope variant so the bypass is
  visible in code, never implicit.

### API keys

Bound to one org + one role at creation (≤ creator's role). Independent grants: revoking a
user's membership does not silently repoint their keys; keys are listed/revocable per org.

### Audit

`logAudit` gains `orgId` from `AuthContext`; instance actions log `orgId = null`.

## 5. Migration & backward compatibility

Prisma migration adds the new tables/columns, makes `passwordHash` nullable, adds FKs.

**Idempotent backfill (runs once):**

1. Create a **default org** (`name "Default"`, slug `default`).
2. Each existing user → instance `role = superadmin` (all are `admin` today) + `owner`
   `Membership` in the default org.
3. Each existing `NetworkMeta` → `orgId = default`.
4. **Reconcile controller-only networks** (exist on controller, no `NetworkMeta` row):
   create a `NetworkMeta` assigned to the default org, so nothing becomes invisible.
5. Existing `ApiKey` → `orgId = default`, `role = owner`.
6. Existing `NetworkTemplate` / webhook `Setting` → default org.
7. Existing `AuditLog` → `orgId = default`.

**First-run setup** (`POST /setup`): bootstrap user created as `superadmin` **and** given an
`owner` membership in a freshly created default org — a new install matches a migrated one.
Remains a no-op once any user exists.

**Super-admin visibility in orgs:** super-admins are not listed as org members by default.
When a super-admin acts in an org, that presence is surfaced only to the org's **owners/admins
and other super-admins** — editors and viewers never see phantom super-admin members.

**Orphan guard:** a network whose `NetworkMeta.orgId` matches no org is visible only to
super-admins in an "unassigned" view, never silently to a tenant. Deleting an org requires
first reassigning/deleting its networks (owner action) — no accidental cascade-delete of
live controller networks.

## 6. API surface

All under `/api/v1`. Reuses the existing error envelope; adds `403 FORBIDDEN`. All input
zod-validated; `GET /openapi.json` regenerates.

**New — org management**

- `GET /orgs` · `POST /orgs` (**super-admin only**; creator → `owner`) ·
  `GET/PATCH/DELETE /orgs/{orgId}`
- `POST /orgs/{orgId}/active` — set the session's `activeOrgId` (org-switcher)

**New — members & roles (org-scoped)**

- `GET /orgs/{orgId}/members`
- `PATCH /orgs/{orgId}/members/{userId}` — change role (can't demote last owner)
- `DELETE /orgs/{orgId}/members/{userId}`
- `POST /orgs/{orgId}/members` — direct-create user (temp password + role)

**New — invitations**

- `GET/POST /orgs/{orgId}/invitations` (create returns link once) ·
  `DELETE /orgs/{orgId}/invitations/{id}`
- `GET /invitations/{token}` (public preview) · `POST /invitations/{token}/accept`
  (set username/password, join)

**Changed** — every org-owned route (`/networks*`, `/networks/{nwid}/members*`, `/rules`,
`/templates*`, `/settings/webhook`, `/audit`) swaps `requireAuth` → `requireOrgRole(action)`
and uses org-scoped accessors. `GET /networks` returns only the active org's networks.
`GET /me` gains memberships + active org + `isSuperAdmin`. `POST /apikeys` gains `orgId` +
`role` (≤ caller's role).

**Instance-global** — `/controller/*`, `/backup*`, `/metrics` become **super-admin only**.

## 7. UI

- **Org switcher** in the app shell (writes `activeOrgId`); all views reflect the active org.
- **Members & roles page** — member list with policy-gated role dropdowns, remove,
  direct-create, and invitations panel (create link → copy, revoke).
- **Invite acceptance page** (`/invite/[token]`, public) — preview org + role, set
  credentials, join.
- **Super-admin area** — org list + create/delete, plus existing instance concerns
  (controller status, backups, metrics), gated to super-admins.
- **Existing pages** (networks, members, audit, templates, API keys) — filtered to active
  org; write controls hidden/disabled by role. API-key form gains org + role.
- **Account page** — extend to list memberships and mark super-admin.

## 8. OIDC/SSO seams (design only)

Nothing OIDC-specific is built; these make it additive later:

- `passwordHash` optional — a user can be authenticated entirely by an external provider.
- `Identity` table — future OIDC callback upserts `Identity(provider=oidc, subject=sub)` →
  existing user, or creates User + Identity; org/role model untouched.
- Role assignment is data-driven via `Membership`, so future **group→role mapping** and
  **just-in-time provisioning** are pure data writes against existing tables.
- `Invitation.email` reserved so SSO can pre-authorize a subject/email.
- Auth resolution centralized in the `AuthContext` layer — an OIDC credential source sits
  alongside password + API key without touching route handlers.

Explicitly out: OIDC login button, discovery/callback route, provider config UI (P2 item,
unblocked by this design).

## 9. Testing strategy (TDD)

- **Policy module** — exhaustive unit tests of `can(role, action)` across all four roles +
  super-admin (pure function).
- **Scoped accessors** — tests that an org-owned fetch requires an `orgId` and that
  cross-org access returns nothing.
- **Integration (per changed route)** — 403 for insufficient role, success for sufficient,
  and **cross-org isolation** (org A's user gets 404/empty on org B's network). Invite
  accept flow, direct-create, org-switch, last-owner protection.
- **Migration test** — seed a v1-shaped DB, run backfill, assert default org + owner
  memberships + all networks/keys/templates/audit assigned.

## 10. Build order (phases — each independently shippable & green)

1. **Schema & migration** — models, nullable `passwordHash`, backfill, first-run setup
   change. No behavior change yet (single default org, everyone owner).
2. **AuthContext + policy + scoped accessors** — wire `requireOrgRole` into existing routes;
   add cross-org isolation. Roles enforced within the default org.
3. **Org management + membership + roles** — org CRUD, members page, role changes,
   org-switcher, super-admin area.
4. **Invitations + direct-create** — tokens, accept flow, invite UI, org-scoped API keys.

After Phase 2 the system is correctly authorized; Phases 3–4 add the multi-org and
onboarding surface.

## 11. Resolved planning questions

- **Org creation** — super-admin only.
- **Webhook config storage** — org-prefixed `Setting` keys (`webhook:{orgId}:…`); no new table.
- **Super-admin visibility in orgs** — limited to the org's owners/admins and other
  super-admins; not shown to editors/viewers.
- **Org slug** — derive from the name via slugify (lowercase, non-alphanumerics → hyphens,
  trimmed); on collision append a short suffix (`-2`, `-3`, …) until unique. Stored unique.
