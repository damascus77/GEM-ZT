# GEM-ZT — Completed

Items moved out of `TODO.md` on 2026-07-03 because they're done. Kept verbatim (including
their `*(Fixed: ...)*` notes) for reference.

## 1. Tracked engineering follow-ups (already known)

### Correctness / resilience

- ✅ **[DONE] [P1]** ~~Controller auth failure maps to a generic 500, not the degraded UI.~~
  _(Fixed: `handleRouteError` maps controller `401`/`403` to a 502 degraded response so the banner
  trips; `DegradedBanner` now surfaces the server's specific reason. `lib/api/errors.ts`,
  `components/DegradedBanner.tsx`.)_
- ✅ **[DONE] [P1]** ~~`getControllerClient()` caches the token forever.~~ _(Fixed: added
  `invalidateControllerClient()`, called on a controller `401`/`403` so the next request re-reads
  the token — recovers from a rotated `authtoken.secret` without a restart. `lib/controller/index.ts`.)_
- ✅ **[DONE] [P2]** ~~`login()` user-enumeration timing side-channel.~~ _(Fixed: an unknown username
  now verifies against a constant dummy argon2 hash so timing doesn't leak user existence.
  `lib/services/auth.ts`.)_
- ✅ **[DONE] [P2]** ~~`listAuditLog` orders by `createdAt` only~~ _(Fixed: `orderBy:
[{createdAt:'desc'},{id:'desc'}]`. `lib/services/audit.ts`.)_
- ✅ **[DONE] [P2]** ~~API-key date-only expiry shifts by timezone.~~ _(Fixed: `dateInputToEndOfDayIso`
  interprets the picked date as end-of-local-day. `lib/util/date.ts`, `app/(ui)/apikeys/page.tsx`.)_
- ✅ **[DONE] [P2]** ~~`requireAuth` is case-sensitive on the `Bearer ` scheme~~ _(Fixed: scheme
  parsed case-insensitively per RFC 7235; token stays case-sensitive. `lib/api/auth.ts`.)_

### Tooling / CI / deps

- ✅ **[DONE] [P1]** ~~Add `typecheck` + lint scripts and wire into CI.~~ _(Done: `typecheck`/`lint` scripts,
  `.eslintrc.json` (next/core-web-vitals), all tsc nits cleaned, `.gitlab-ci.yml` runs typecheck+lint+test.)_
- ✅ **[DONE] [P1]** ~~Actually run the CI-gated e2e + `docker compose build` in CI.~~ _(Done: `.gitlab-ci.yml`
  has an `e2e` job (DinD, `allow_failure`) and a `docker-build` job (`docker build`, `allow_failure`).)_
- ✅ **[DONE] [P1] Next.js 14 → 15 upgrade, clearing every CVE in next's own code.** _(Fixed
  2026-07-03: bumped to the latest 15.5.x; the only breaking change hit was async
  `params`/page-props across 11 route/page files, all converted to
  `Promise<{...}>` + `await`. `npm audit` still lists one `next` entry — that's a transitive
  advisory against next's bundled `postcss` copy (GHSA-qx2v-qp2m-jg93), not a CVE in next
  itself; it clears only when a future next release bumps its vendored postcss. See
  `docs/superpowers/specs/2026-07-03-nextjs-15-upgrade-design.md`.)_

### Cleanup

- ✅ **[DONE] [P2]** ~~Remove dead `isValidCidr` import~~ in `components/networks/RoutesEditor.tsx` and
  ~~the stray `eslint-disable @typescript-eslint/no-var-requires`~~ above an ES `import` in
  `lib/rules/compiler.ts`. _(Both removed.)_
- ✅ **[DONE] [P2]** ~~Extract a `useNetworkDetail(nwid)` hook.~~ _(Done: `components/networks/
useNetworkDetail.ts`, now used by `NetworkSettings`, `RoutesEditor`, and `DnsEditor`.)_

## 2. Issues you may encounter (review)

1. ✅ **[P0]** ~~Backup/restore + `down -v` destroys the controller identity forever.~~ (done — README)
2. ✅ **[P1]** ~~`/setup` takeover if the box is reachable or `app_data` is lost.~~ (done — `GEMZT_SETUP_TOKEN`)
3. ✅ **[P1]** ~~`prisma db push` on boot has no migration history (schema-change footgun).~~ (done — `migrate deploy`)
4. ✅ **[P1]** ~~Stale "Managed IPs" input can wipe a member's live auto-assigned IP.~~ (done — re-seed guard)
5. ✅ **[P1]** ~~Member action failures (authorize/IP/remove) are silent.~~ (done — row alert)
6. ✅ **[P1]** ~~Rules editor can silently overwrite live rules with the default template.~~ (done — warning)
7. ✅ **[P1]** ~~Member list is N+1 against the controller every 5s per open tab.~~ (done — concurrency cap 8 + 10s poll)

### Data & persistence

- ✅ **[DONE] [P0] No backup/restore story; `docker compose down -v` irreversibly destroys the controller
  identity and every network.** _(Fixed 2026-07-03: README Backup & Restore section + `down -v` warning.)_
- ✅ **[DONE] [P1] Startup `prisma db push` has no migration history — first lossy schema change bricks or drifts
  the deployment.** _(Fixed: committed `prisma/migrations/` + `migrate deploy` at start. Existing db-push'd DBs need a one-time `migrate resolve` — see README "Upgrading".)_
- ✅ **[DONE] [P1] Rules editor silently replaces live custom rules with the default template when `rulesSource`
  metadata is missing.** _(Fixed: `getRules` returns `sourceIsDefault`; editor warns before a save can overwrite.)_
- ✅ **[DONE] [P2]** ~~SQLite + Prisma default pool → intermittent "database is locked" under concurrent
  writes.~~ _(Fixed: `getDb()` forces `connection_limit=1` and applies WAL + `busy_timeout=5000` +
  `synchronous=NORMAL` pragmas on init. `lib/db/client.ts`)_
- ✅ **[DONE] [P2]** ~~Expired sessions and audit rows are never purged.~~ *(Fixed: `purgeExpiredSessions()`
  - `purgeAuditLogsOlderThan(cutoff)`, run via a self-throttled `runRetention()` wired into the login
    route. Retention window: `GEMZT_AUDIT_RETENTION_DAYS` (default 90). `lib/services/retention.ts`)*

### Controller integration

- ✅ **[DONE] [P1] Member list is N+1 against the controller every 5s per open tab.** _(Fixed: `mapWithConcurrency` caps per-member GETs at 8; poll interval 5s→10s.)_
- ✅ **[DONE] [P2]** ~~PATCH to a nonexistent member silently creates it on the controller.~~ _(Fixed:
  `updateMember` GET-firsts so a typo'd memberId 404s instead of minting a phantom. `lib/services/members.ts`)_
- ✅ **[DONE] [P2]** ~~`nwid`/`memberId` params are never format-validated and are interpolated into
  controller URLs.~~ _(Fixed: `ControllerClient` validates `^[0-9a-f]{16}$` / `^[0-9a-f]{10}$` before every
  request; `InvalidControllerIdError` → 400. `lib/controller/client.ts`, `lib/api/errors.ts`)_

### Security & auth

- ✅ **[DONE] [P1] First-boot (and post-DB-loss) admin takeover: `/setup` is open to whoever reaches port 3000 first.**
  _(Fixed: optional `GEMZT_SETUP_TOKEN` — when set, `/setup` requires it. Reverse-proxy guidance in README.)_
- ✅ **[DONE] [P2]** ~~Session tokens are Prisma `cuid()`, not CSPRNG.~~ _(Fixed: `createSession` issues a
  256-bit `randomBytes` hex token as the session id. `lib/services/auth.ts`)_
- ✅ **[DONE] [P2]** ~~Session cookie lacks `Secure`~~ _(Fixed: `sessionCookieOptions()`/`clearSessionCookieHeader()`
  set `Secure` when `GEMZT_COOKIE_SECURE=true`, used across login/setup/logout. `lib/services/auth.ts`)_
- ✅ **[DONE] [P2]** ~~No login rate limiting.~~ _(Fixed: in-memory per-username failed-login limiter →
  429 + `Retry-After` after `GEMZT_LOGIN_MAX_ATTEMPTS` (default 5) failures per `GEMZT_LOGIN_WINDOW_MS`
  (default 15m); resets on success. `lib/services/rateLimit.ts`, `app/api/v1/auth/login`)_

### Deployment & ops

- ✅ **[DONE] [P2] No healthchecks; `depends_on` is start-order only.** _(Fixed: controller healthcheck on
  `authtoken.secret` + app `depends_on: condition: service_healthy`; app healthcheck hits
  `/api/v1/setup/status` via Node's global fetch. `docker-compose.yml`)_
- ✅ **[DONE] [P2]** ~~Single-stage image ships devDependencies + source and runs as root.~~ _(Fixed: Next
  standalone multi-stage `Dockerfile` running `USER node`; `output:'standalone'` in next.config; a
  `docker-entrypoint.sh` runs `prisma migrate deploy` then `node server.js`. NOT built here — no Docker in the dev env.)_

### UX / error-handling

- ✅ **[DONE] [P1] Stale "Managed IPs" input can wipe a member's auto-assigned IP.** _(Fixed: `MemberRow` re-seeds
  from the server unless mid-edit, and re-syncs after save.)_
- ✅ **[DONE] [P1] Authorize / Deauthorize / Save IPs / Remove failures are silent.** _(Fixed: `MemberRow` renders a
  `role="alert"` row showing the mutation error. Remove/DELETE path parses the response body's `error.message`.)_
- ✅ **[DONE] [P2] Settings/Routes/DNS editors seed once and save whole stale snapshots.** _(Fixed: all three
  editors now re-seed from the server when it changes and the field is untouched (dirty-flag guard).
  `components/networks/*`)_
- ✅ **[DONE] [P2] No delete-network control in the UI, and member "Remove" has no confirmation.** _(Fixed:
  `NetworkActions` adds a danger-zone Delete (type-the-nwid confirm) that calls `DELETE /networks/{nwid}`;
  member "Remove" now confirms first, individually and in bulk.)_

## 3. Feature roadmap (review)

### ZTNET-parity features

- ✅ **[DONE] [P1] Member tags & capabilities UI.** *(Done: `capabilityTagMaps()` parses name→id maps from the
  rules source, surfaced via GET /networks/{nwid}/rules; `MemberTable` renders per-member capability checkboxes
  - tag value inputs and PATCHes capabilities/tags.)*
- ✅ **[DONE] [P1] Member search, filter, and sort.** _(Done: `lib/util/memberFilter.ts` + a toolbar in
  `MemberTable` — free-text name/ID/IP search, authorized/pending + online/offline filters, and column
  sort. NetworkList search also done — `lib/util/networkFilter.ts`.)_
- ✅ **[DONE] [P1]** Per-member `noAutoAssignIps`/`activeBridge` toggles now render in `MemberTable`.
  (Network-level v4/v6 toggles already shipped in `RoutesEditor`.)
- ✅ **[DONE] [P1] Dark mode.** _(Done 2026-07-03: CSS-variable theming — neutral tokens flip under a `.dark`
  class; defaults to dark with a no-flash inline script + `localStorage` toggle in the sidebar/auth screen.)_
- ✅ **[DONE] [P2] TOTP 2FA for admin login.** _(Done: dependency-free RFC 6238 TOTP (`lib/services/totp.ts`),
  `User.totpSecret`/`totpEnabled` + migration, enroll/enable endpoints, and enforcement at `/auth/login`
  — no session issued until the code verifies.)_
- ✅ **[DONE] [P1] IPv4/IPv6 assign-mode UI — IPv6 pools.** _(Fixed 2026-07-03: the
  `v4AssignMode`/`v6AssignMode` checkboxes and per-member `activeBridge`/`noAutoAssignIps`
  toggles were already shipped; this closed the remaining gap where "IPv6 from pools" had no
  way to actually create an IPv6 pool. `cidrToPool()` now supports IPv6 CIDRs, and
  `validateRoutesAndPools()` no longer misreports IPv6 pools as malformed. See
  `docs/superpowers/specs/2026-07-03-ipv6-assign-mode-ui-design.md`.)_

### Beyond ZTNET (UX & operator wins)

- ✅ **[DONE] [P1] Config backup & restore.** _(Done: `lib/services/backup.ts` — `exportBackup()` →
  GET /api/v1/backup (JSON download) and `restoreBackup()` → POST /api/v1/backup/restore. `BackupControls`
  on the networks page.)_
- ✅ **[DONE] [P1] Bulk member actions.** _(Done: checkbox selection + select-all → authorize / deauthorize /
  delete selected in `MemberTable`, plus a "Select offline" quick-select for cleanup.)_
- ✅ **[DONE] [P1] Inline validation & conflict feedback for routes/pools/DNS.** _(Done:
  `lib/util/networkValidation.ts` warns on overlapping routes, pools outside every managed route, `via`
  gateways not inside a route, and malformed DNS servers.)_
- ✅ **[DONE] [P2] Pending-member approval queue + shareable join page.** _(Done: `/pending` dashboard
  aggregates unauthorized members across all networks with authorize/deny (`lib/services/pending.ts` +
  GET /api/v1/pending); per-network `/networks/{nwid}/join` page with per-OS `zerotier-cli join` commands +
  copy buttons.)_
- ✅ **[DONE] [P2] Network templates / clone network.** *(Done: `cloneNetwork()` + `POST /networks/{nwid}/clone`
  - "Clone network" button. Named templates also done — `NetworkTemplate` model (+ migration
    `20260704120000_add_network_template`), `lib/services/templates.ts`, `/api/v1/templates[/{id}[/apply]]`,
    "Save as template" in `NetworkActions` + a Templates list on the networks page.)*
- ✅ **[DONE] [P2] Member presence history / last-seen timeline.** _(Done: `MemberPresence` model + migration,
  `lib/services/presence.ts` (opportunistic throttled sampler wired into the members-list route, retention via
  runRetention), GET /networks/{nwid}/presence, and per-member "last seen" + a div-based sparkline in
  `MemberTable`.)_
- ✅ **[DONE] [P2] Flow-rule change preview + audit diffs.** _(Done: `lib/util/jsonDiff.ts` LCS diff; RulesEditor
  "Preview changes" shows live-vs-compiled rules diff before save; network/member/rules update routes store
  `{before, after}` in `AuditLog.detail` and the audit page renders the diff.)_
- ✅ **[DONE] [P3] Prometheus metrics + status dashboard.** _(Done: `GET /api/v1/metrics` (text exposition)
  via `lib/services/metrics.ts`, plus a `/status` dashboard page (`StatusDashboard` parses the metrics text)
  showing controller reachability + inventory counts.)_

## 4. Moved 2026-07-17

Verified complete against the working tree and moved out of `TODO.md`.

- ✅ **[DONE] [P1] Multi-user, organizations, and roles.** _(Done: full multi-tenant stack —
  `Organization`/`Membership`/`Invitation`/`Identity` models in `prisma/schema.prisma` (org-scoped
  `NetworkMeta`/`ApiKey`/`AuditLog`/`NetworkTemplate`); two role dimensions (`User.role`
  superadmin/user + per-org `Membership.role` owner/admin/editor/viewer); a policy layer
  `lib/authz/policy.ts` + `lib/authz/roles.ts`; per-route enforcement via `requireOrgRole` /
  `requireSuperAdmin` (`lib/api/authz.ts`) across ~25 API routes with role-cap escalation guards;
  a single-use hashed-token invitations system (`lib/services/invitations.ts` + routes); audit
  logging in 19 routes; and management UI — `components/OrgMembers.tsx`, `OrgInvitations.tsx`,
  `OrgSwitcher.tsx`, `AdminOrgs.tsx`, plus `/orgs/[orgId]/members`, `/admin`, and the invite-accept
  flow. Was the explicit v1 deferral (spec §11); see
  `docs/superpowers/specs/2026-07-05-multi-user-orgs-roles-design.md`. Authorization lives in route
  handlers rather than global `middleware.ts` — by design.)_
- ✅ **[DONE] [P1] (M1) Member section UX speed / live updates.** _(Done: React Query with
  `staleTime` + `keepPreviousData` (`app/providers.tsx`), `refetchInterval` polling for members and
  presence, optimistic `patch` mutations with `onError` rollback and freshest-cache reads, memoized
  `MemberRow`, a request-coalescing controller cache (`lib/util/cache.ts`) with write-time bust, and a
  direct/relayed connection indicator (`ConnectionPill` + "Connection" column). Commits `dbc009a`,
  `ce61d5c`, `6d6f1cd`. Caveat: passive online/offline still updates on the poll interval (default
  30s) rather than push — a WebSocket/SSE path and row virtualization were deferred, and the
  direct/relayed heuristic still wants validation against a live controller `/peer`.)_
- ✅ **[DONE] (M3) Accepted-field chip validation.** _(Done in `89a4e96`: `components/ui/AcceptedChip.tsx`
  (`AcceptedChip`/`AcceptedChips`) shows a "… accepted: <value>" chip once a field validates, wired into
  `MemberTable` (managed IPs) and `RoutesEditor` (route targets / IP pools / CIDR helper). IPv4-only by
  design — IPv6 follow-up tracked as **M8**.)_
- ✅ **[DONE] (M5) Network-detail layout ordering.** _(Done: `app/(ui)/networks/[nwid]/page.tsx` now leads
  with a "Frequent network controls" grid (`NetworkSettings` + `RoutesEditor` side by side), then
  `MemberTable`, with `DnsEditor` and `RulesEditor` (flow rules) pushed to the bottom — members and
  routes/IP pools are reachable without scrolling, flow rules and DNS stay below.)_

- ✅ **[DONE] (M7) Mine ZTNET release notes for TODO ideas.** _(Done 2026-07-17: read ZTNET's GitHub
  release history v0.7.x–v0.8.x and folded seven new candidate items (I1–I7) into `TODO.md` under
  "Ideas from ZTNET release notes" — real-time WebSocket/SSE updates, row virtualization / DB-first
  member sync, i18n, responsive/PWA, duplicate-route prevention, configurable rate limits, and SMTP
  STARTTLS — each triaged into the execution order.)_
- ✅ **[DONE] [P2] Backup/restore edge case — no stored `rulesSource`.** _(The functional re-push landed
  earlier in `f26987f` (existing network with compiled rules but no source now pushes the backup's
  captured `rules`/`capabilities`/`tags` directly instead of silently keeping live rules). Completed
  2026-07-17 by adding the missing operator-facing **warning**: `restoreBackup()` now pushes a
  `summary.warnings` entry ("no editable rules source on record — restored the backup's compiled rules
  directly …") for that path. `lib/services/backup.ts`; covered by `tests/unit/backup-restore.test.ts`
  and `tests/integration/backup-restore-route.test.ts`.)_
- ✅ **[DONE] (M9) Managed-IP add/remove flow + chip readability.** _(Done 2026-07-17: the member
  "Managed IPs" cell is now add-one-at-a-time — type an IPv4, press Enter or "Add IP", it's saved and
  the box clears for the next; each committed IP renders as a chip with a red "×" remove button
  (`AcceptedChip` gained an optional `onRemove`); duplicate/invalid/IPv6 input is rejected inline
  (IPv6 tracked as M8). The accepted chip's low-contrast teal-on-dark (`teal-deep` #0e3030 on the
  #100e1c dark canvas) was replaced with a solid `teal-mid` fill + white text so IP/Route/Pool chips
  read in both themes. `components/ui/AcceptedChip.tsx`, `components/members/MemberTable.tsx`;
  `tests/ui/member-table.test.tsx` updated. This also retired the old whole-list-in-a-textbox input and
  its stale-IP re-seed guard, which the per-IP model makes structurally unnecessary.)_

## 5. Moved 2026-07-17 (second wave)

- ✅ **[DONE] (M8) IPv6 accepted-field chip validation.** _(Done 2026-07-17: cidr.ts already had the
  IPv6 machinery (`isValidCidr` covers v4+v6, `cidrToPool` v6); added a combined `isValidIp` (v4 or v6)
  and switched every accepted-chip validator to the v4+v6-aware helpers — member managed IPs
  (`MemberTable`, now accepts IPv6 in the M9 add flow), route targets / gateways / IP-pool endpoints /
  the CIDR helper (`RoutesEditor`). The server side already accepted IPv6 everywhere (`z.string().ip()`
  and `isValidCidr`), so this was a client-validation-only change. `lib/util/cidr.ts`,
  `components/members/MemberTable.tsx`, `components/networks/RoutesEditor.tsx`; unit test for
  `isValidIp` + flipped the two "IPv6 not accepted yet" UI tests to assert acceptance.)_
- ✅ **[DONE] [P2] Pending-queue polish — self-authorize join tokens + QR.** _(Done 2026-07-17: a
  network admin can mint a time-limited, optionally use-capped **self-authorize join link** so a device
  can authorize itself right after `zerotier-cli join`, without manual approval. New `JoinToken` Prisma
  model + migration `20260717120000_add_join_token`; `lib/services/joinTokens.ts` (hashed `jt_` tokens
  like invitations, TTL ceiling 30d, atomic single-use claim via gated `updateMany`, controller-failure
  roll-back so a not-yet-joined device doesn't burn a use); admin routes
  `POST/GET /networks/{nwid}/join-tokens` + `DELETE .../{id}` (role-gated, audited); public
  IP-rate-limited `POST /networks/{nwid}/self-authorize`. UI: `components/networks/JoinLinkPanel.tsx`
  (generate link + **QR** + copy + active-list + revoke) on the network page, and the public
  `JoinInstructions` gained a network-ID QR + a self-authorize form when the URL carries `?token=`.
  `qrcode` was already a dependency (used by TOTP), so no new deps. Tests:
  `tests/unit/join-tokens-service.test.ts` + `tests/integration/self-authorize-route.test.ts`.
  Note: the earlier deferral reasons (QR dependency, extra token table) are both resolved; the public
  self-authorize redemption is intentionally not audit-logged since it has no acting user — revisit if
  per-device attribution is wanted.)_

## 6. Moved 2026-07-19

- ✅ **[DONE] (M2) Standalone account management + sidebar reorg.** _(Done 2026-07-19:
  account creation is now reachable from a first-class `/accounts` page instead of being hidden
  under an active organization's Members page. Added `components/AccountManagement.tsx`, which
  selects manageable orgs (super-admins see all; org owners/admins see their manageable orgs),
  renders scoped `OrgMembers` + `OrgInvitations`, and defaults to the active manageable org or the
  first manageable fallback. `OrgMembers` now has a fixed-org reuse mode for `/accounts` while
  preserving the old cross-org picker on `/orgs/{orgId}/members`. `components/Sidebar.tsx` now has
  a role-scoped Account Management group (`/accounts`, `/accounts#invitations`), renames personal
  settings to "My Account", and moves `OrgSwitcher` to the bottom sidebar controls.)_
- ✅ **[DONE] (I5) Prevent duplicate managed routes.** _(Done 2026-07-19: added reusable
  duplicate target detection in `lib/util/networkValidation.ts` keyed by trimmed/lowercased
  route targets. `RoutesEditor` now blocks Save before PATCH and shows the duplicate route
  error inline, while `updateNetworkSchema` rejects duplicate `routes` server-side before the
  controller is patched. Operators must remove or change the duplicate row; no auto-merge.)_
- ✅ **[DONE] (I6) Configurable runtime rate-limit settings.** _(Done 2026-07-19: added
  `lib/services/rateLimitSettings.ts` backed by the global `Setting` table with env defaults,
  cache reset, and in-memory limiter rebuilds. New super-admin-only
  `GET/PUT /api/v1/admin/rate-limits` returns defaults/effective/overrides and validates
  positive attempt counts plus windows `>= 1000ms`. Login and self-authorize routes now read
  the effective config at request time, and `/admin` includes an editable `RateLimitSettings`
  panel.)_
- ✅ **[DONE] (M6) Admin ZT Controller status/settings page.** _(Done 2026-07-19:
  `/api/v1/controller/status` still returns `address`, `online`, and `version`, and now also
  includes redacted controller connection settings (`controllerUrl`, timeout, cache TTL) plus
  best-effort network/peer/active path counts. `/admin` now shows an `AdminControllerPanel`
  alongside rate-limit settings and existing organization management. Controller credentials
  remain server-only.)_

## 6. Completed 2026-07-20 — OIDC/SSO login + P0 audit findings

### Feature

- ✅ **[DONE] [P1] OIDC/SSO login.** _(Done 2026-07-20: generic discovery-based OIDC
  (Google/Okta/Authentik/Keycloak/Azure AD) in `lib/services/oidc.ts` with login + callback routes
  (`app/api/v1/auth/oidc/login|callback`), PKCE + state/nonce, passwordless auto-provisioning via
  the `Identity(provider, subject)` table, and env-driven group→org/role mapping. Memberships are
  reconciled from claims on every login with an `origin="oidc"` provenance marker so SSO never
  touches manual grants. Revoke honors the last-owner invariant (a sole SSO owner is retained, not
  orphaned) and cascades org-scoped API-key revocation, mirroring `orgs.ts#removeMember`.)_

### Audit findings (2026-07-19) — P0 set

- ✅ **[DONE] [UI] AUD-01 Status pills & diff text invisible in dark theme.** _(Fixed: extracted a
  `components/ui/Pill.tsx` primitive using `bg-teal-mid text-white` (WCAG-passing); the old
  ~1.1:1 `text-teal-deep`-on-canvas pattern is gone from `MemberTable`, `StatusDashboard`,
  `PendingMembers`, `RulesEditor`, and the audit diff.)_
- ✅ **[DONE] [REL] AUD-02 `createOrg` not atomic.** _(Fixed: `organization.create` +
  `membership.create` wrapped in one `$transaction` (`lib/services/orgs.ts:46`), so an org can
  never exist without its owner.)_
- ✅ **[DONE] [REL] AUD-03 Last-owner guard TOCTOU race.** _(Fixed: the owner-count check and the
  demote/remove write now run inside one `$transaction` in `setMemberRole`/`removeMember`
  (`lib/services/orgs.ts`), so concurrent operations can't strip the final owner.)_
- ✅ **[DONE] [REL] AUD-04 Unbounded controller fan-out in network-list paths.** _(Fixed: all three
  sites in `lib/services/networks.ts` (L170/207/257) route through
  `mapWithConcurrency(ids, NETWORK_FETCH_CONCURRENCY, …)` instead of raw `Promise.all`.)_
- ✅ **[DONE] [REL] AUD-05 Backup restore non-idempotent / partial state.** _(Fixed: restore is now
  continue-on-error with per-item `RestoreSummary.warnings` (`lib/services/backup.ts`); the
  non-idempotent-once-nwids-change behavior is documented in the function contract.)_
