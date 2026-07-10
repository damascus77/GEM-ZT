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
