# GEM-ZT — TODO

Working backlog for GEM-ZT. v1 (32 tasks) is merged to `master` and runs in Docker
via `docker compose up -d --build`. This file tracks what's left.

Legend: **[P0]** blocker / do now · **[P1]** important · **[P2]** nice-to-have.

---

## 1. Tracked engineering follow-ups (already known)

These were logged during the build/review and the Docker bring-up. None block running
v1 today, but each is worth closing.

### Correctness / resilience
- **[P1] Controller auth failure maps to a generic 500, not the degraded UI.** A controller
  `401`/`403` (e.g. misconfig) falls through `handleRouteError` to `INTERNAL` 500, and the
  "controller degraded" banner only trips on `502`. Map controller auth/connectivity failures
  to a clear degraded state so the UI explains it instead of throwing raw errors.
  (`lib/api/errors.ts`, `components/DegradedBanner.tsx`.)
- **[P1] `getControllerClient()` caches the token forever.** If the controller regenerates its
  `authtoken.secret`, the app 401s until restarted — there's no re-read on auth failure. Invalidate
  the cached client and re-read the token on a controller `401`. (`lib/controller/index.ts`.)
- **[P2] `login()` user-enumeration timing side-channel.** Unknown username returns early without
  paying the argon2 cost, so response timing distinguishes "no such user" from "wrong password".
  Verify against a dummy hash when the user is missing. (`lib/services/auth.ts`.)
- **[P2] `listAuditLog` orders by `createdAt` only** (ms resolution, no tiebreak) → nondeterministic
  ordering for same-millisecond rows. Use `orderBy: [{createdAt:'desc'},{id:'desc'}]`. (`lib/services/audit.ts`.)
- **[P2] API-key date-only expiry shifts by timezone.** `type="date"` → `new Date(v).toISOString()`
  is parsed as UTC midnight; a positive-offset TZ stores the prior local day. (`app/(ui)/apikeys/page.tsx`.)
- **[P2] `requireAuth` is case-sensitive on the `Bearer ` scheme** (RFC 7235 says case-insensitive).
  (`lib/api/auth.ts`.)

### Tooling / CI / deps
- **[P1] Add `typecheck` + lint scripts and wire into CI.** No `tsc --noEmit`/lint script exists;
  this is exactly why the `vitest.config.ts` type error only surfaced in a Docker `next build`. Add
  `"typecheck": "tsc --noEmit"` (test files currently emit minor type nits — clean those up) + ESLint.
- **[P1] Actually run the CI-gated e2e (Task 32) + `docker compose build` in CI.** They were deferred
  ("Docker unavailable") and have never run automatically. Add a CI job: `npm run test:e2e` and a build.
- **[P2] Bump `next`** — `npm ci` reports 6 vulnerabilities (3 moderate / 2 high / 1 critical), all from
  the pinned `next@14.2.x` transitive tree. Take a `next` minor/patch bump.
- **[P2] Prisma 5.22 → 7.x** major upgrade available (surfaced in container logs). Optional; follow the
  migration guide if taken.

### Cleanup
- **[P2] Remove dead `isValidCidr` import** in `components/networks/RoutesEditor.tsx` and the stray
  `eslint-disable @typescript-eslint/no-var-requires` above an ES `import` in `lib/rules/compiler.ts`.
- **[P2] Extract a `useNetworkDetail(nwid)` hook.** The `['network', nwid]` `useQuery` block is
  copy-pasted across `NetworkSettings`, `RoutesEditor`, and `DnsEditor`.

## 2. Issues you may encounter (review)

> **Hardening pass done 2026-07-03** (commits `de29dec`, `1f6e9f0`): ✅ backup/restore docs +
> `down -v` warning (README), ✅ member "Managed IPs" stale-input wipe guard, ✅ rules-editor
> default-template overwrite warning, ✅ `/setup` bootstrap-token guard (`GEMZT_SETUP_TOKEN`).

**Top priorities, in order:**
1. ✅ **[P0]** ~~Backup/restore + `down -v` destroys the controller identity forever.~~ (done — README)
2. ✅ **[P1]** ~~`/setup` takeover if the box is reachable or `app_data` is lost.~~ (done — `GEMZT_SETUP_TOKEN`)
3. ✅ **[P1]** ~~`prisma db push` on boot has no migration history (schema-change footgun).~~ (done — `migrate deploy`)
4. ✅ **[P1]** ~~Stale "Managed IPs" input can wipe a member's live auto-assigned IP.~~ (done — re-seed guard)
5. ✅ **[P1]** ~~Member action failures (authorize/IP/remove) are silent.~~ (done — row alert)
6. ✅ **[P1]** ~~Rules editor can silently overwrite live rules with the default template.~~ (done — warning)
7. ✅ **[P1]** ~~Member list is N+1 against the controller every 5s per open tab.~~ (done — concurrency cap 8 + 10s poll)

> **Second hardening pass done 2026-07-03** (commits `e981182`, `beae224`, `8b2eb55`): ✅ member-action
> error surfacing, ✅ member-list fan-out bounded (cap 8) + poll slowed to 10s, ✅ `prisma migrate deploy`
> at container start (see README "Upgrading" — existing db-push'd DBs need a one-time `migrate resolve`).

**Still open — next most impactful:** SQLite `?connection_limit=1`/WAL (P2), compose healthchecks (P2),
session-token CSPRNG + cookie `Secure` (P2), plus the tracked items in §1 and the feature roadmap in §3.

### Data & persistence
- ✅ **[DONE] [P0] No backup/restore story; `docker compose down -v` irreversibly destroys the controller
  identity and every network.** *(Fixed 2026-07-03: README Backup & Restore section + `down -v` warning.)* `controller_data` holds `identity.secret`, whose node ID is the prefix
  of every nwid — lose it and no network can be recreated with the same ID; every joined device is
  orphaned. Nothing documents backing up `controller_data` + `app_data` (and hot-copying the SQLite file
  is unsafe). Add documented backup/restore (stop-and-tar or `sqlite3 .backup` + tar of `controller_data`)
  and a loud warning about `down -v`. (`docker-compose.yml`)
- ✅ **[DONE] [P1] Startup `prisma db push` has no migration history — first lossy schema change bricks or drifts
  the deployment.** *(Fixed: committed `prisma/migrations/` + `migrate deploy` at start. Existing db-push'd DBs need a one-time `migrate resolve` — see README "Upgrading".)* `Dockerfile` runs `npx prisma db push --skip-generate` every boot; a future schema
  change needing data loss fails non-interactively → crash-loop (and rolling back to an older image against
  a newer DB does the same). Switch to `prisma migrate deploy` + committed migrations.
- ✅ **[DONE] [P1] Rules editor silently replaces live custom rules with the default template when `rulesSource`
  metadata is missing.** *(Fixed: `getRules` returns `sourceIsDefault`; editor warns before a save can overwrite.)* `getRules` returns `meta?.rulesSource || DEFAULT_RULES_SOURCE` (`lib/services/rules.ts:22`)
  with no check that it matches `network.rules`. If `app_data` is lost/restored (or a network predates
  GEM-ZT), the editor shows the default and one "Compile & save" overwrites the controller's real rules.
  Detect source/compiled divergence and warn instead of presenting the default as current.
- **[P2] SQLite + Prisma default pool → intermittent "database is locked" under concurrent writes.**
  `verifyApiKey` writes `lastUsedAt` on every API-key request (`lib/services/apiKeys.ts`) alongside audit
  writes; Prisma's multi-connection pool on SQLite yields SQLITE_BUSY under scripted polling. Set
  `?connection_limit=1` and/or WAL + busy_timeout. (`lib/db/client.ts` / `DATABASE_URL`)
- **[P2] Expired sessions and audit rows are never purged.** `getSession` only deletes an expired session
  if that same session is presented again; `AuditLog` grows forever (500-row read cap only). Add retention/cleanup.

### Controller integration
- ✅ **[DONE] [P1] Member list is N+1 against the controller every 5s per open tab.** *(Fixed: `mapWithConcurrency` caps per-member GETs at 8; poll interval 5s→10s. The per-member GET count is inherent — no bulk controller endpoint — but bursts are bounded.)* `listMembers` fires an
  unbounded parallel `getMember` per member + a full `/peer` fetch (`lib/services/members.ts`), on a 5s
  `refetchInterval` — ~100 members ≈ ~100 controller requests per poll per tab, and `updateMember` re-runs
  `loadContext` after every write. Cache peers, batch, or lengthen the interval.
- **[P2] PATCH to a nonexistent member silently creates it on the controller.** The ZT controller creates
  a member on POST, so `updateMember` on a typo'd memberId mints a phantom (possibly pre-authorized) member
  with no error. GET-first or 404 on unknown members. (`lib/services/members.ts`)
- **[P2] `nwid`/`memberId` params are never format-validated and are interpolated into controller URLs.**
  An authenticated caller can steer requests at arbitrary controller API paths (and garbage IDs create junk
  entries). Validate `^[0-9a-f]{16}$` / `^[0-9a-f]{10}$` at the route layer. (`lib/controller/client.ts`, routes)

### Security & auth
- ✅ **[DONE] [P1] First-boot (and post-DB-loss) admin takeover: `/setup` is open to whoever reaches port 3000 first.**
  *(Fixed: optional `GEMZT_SETUP_TOKEN` — when set, `/setup` requires it. Reverse-proxy guidance in README.)*
  The only gate is `userCount() > 0` (`app/api/v1/setup/route.ts`), and compose publishes `3000` on all
  interfaces. If the box is reachable beyond the operator — or `app_data` is ever lost (silently resetting
  to `needsSetup`) — someone else becomes admin of the real controller. Gate setup with a bootstrap-token env
  var or bind `127.0.0.1:3000` by default. (`docker-compose.yml`)
- **[P2] Session tokens are Prisma `cuid()`, not CSPRNG.** `Session.id` is mostly timestamp/counter with
  ~40 bits of randomness — weak for a bearer credential. Issue a 128-bit `randomBytes` token like API keys do.
- **[P2] Session cookie lacks `Secure`; no TLS/reverse-proxy guidance.** Login password travels plain HTTP on
  `0.0.0.0:3000`. Set `secure` when applicable and document a reverse-proxy TLS setup. (`app/api/v1/auth/login`)
- **[P2] No login rate limiting.** argon2 slows single attempts but nothing stops sustained guessing against
  the single admin account. (`app/api/v1/auth/login`)

### Deployment & ops
- **[P2] No healthchecks; `depends_on` is start-order only.** On first boot the app can race the controller's
  `authtoken.secret` creation (502s until it appears — recovers, but looks broken), and Docker never restarts
  a wedged-but-running service. Add a controller healthcheck + `condition: service_healthy` and an app
  healthcheck on `/api/v1/setup/status`. (`docker-compose.yml`)
- **[P2] Single-stage image ships devDependencies + source and runs as root.** Move to Next standalone
  multi-stage + `USER node` (note: the ro-mounted `authtoken.secret` is 0600/foreign-UID, so dropping root
  needs `ZT_AUTH_TOKEN` or permission handling). (`Dockerfile`)

### UX / error-handling
- ✅ **[DONE] [P1] Stale "Managed IPs" input can wipe a member's auto-assigned IP.** *(Fixed: `MemberRow` re-seeds
  from the server unless mid-edit, and re-syncs after save.)* The input previously seeded once at mount and
  never reflected later server changes (`components/members/MemberTable.tsx`). Flow: authorize → controller
  auto-assigns an IP → input still shows the old list → "Save IPs" PATCHes the stale list, deleting the live
  assignment. Re-seed when server data changes (or diff before save).
- ✅ **[DONE] [P1] Authorize / Deauthorize / Save IPs / Remove failures are silent.** *(Fixed: `MemberRow` renders a
  `role="alert"` row showing the mutation error.)* Follow-up polish: the Remove/DELETE path still shows a fixed
  "Delete failed" rather than parsing the response body's `error.message`.
- **[P2] Settings/Routes/DNS editors seed once and save whole stale snapshots.** A tab left open across an
  external change reverts it on save (whole-object PATCH). Send only dirty fields or re-seed on server change.
  (`components/networks/*`)
- **[P2] No delete-network control in the UI, and member "Remove" has no confirmation.** `DELETE /networks/{nwid}`
  exists but no component calls it; meanwhile one misclick removes a member instantly. Add a delete-network
  control (with confirm) and a confirm on member removal. (`components/members/MemberTable.tsx`)

## 3. Feature roadmap (review)

Tags here: **[P1]** high-value / expected of a ZTNET alternative · **[P2]** valuable enhancement ·
**[P3]** longer-term / larger effort.

### ZTNET-parity features
- **[P1] Member tags & capabilities UI.** Parse tag/capability names from the stored flow-rule source
  (the vendored `rule-compiler.js` already emits name→id maps) and render per-member dropdowns/checkboxes
  in `MemberTable`. The API already accepts `capabilities`/`tags` on PATCH — UI-only, and it's what makes
  ZeroTier flow rules usable per-device. Medium effort (`components/members/`).
- **[P1] Member search, filter, and sort.** Free-text search (name/ID/IP), filters (authorized/pending,
  online/offline), column sort — same for the networks list. The table is unusable past ~20 members.
  Small, client-side (`MemberTable.tsx`, `NetworkList.tsx`).
- **[P1] IPv4/IPv6 assign-mode toggles + full per-member controls.** UI for `v4AssignMode.zt`, `v6AssignMode`
  (`zt`/`6plane`/`rfc4193`) in `NetworkSettings`, plus per-member `noAutoAssignIps`/`activeBridge`. Schemas
  already support all of it (`lib/services/networks.ts`); nothing surfaces it. Small.
- **[P1] Dark mode.** Theme toggle persisted in `Setting`/localStorage with a dark variant of the design
  tokens. Table stakes for an ops tool. Small-medium (design-token audit).
- **[P2] Email + webhook notifications.** SMTP settings (the `Setting` model is ready) + outbound webhooks
  for events: unauthorized member appeared, member deauthorized, controller degraded. "A new device knocked"
  is the single most useful push for a homelab. Medium (a diff poller + dispatch in `lib/services/`).
- **[P2] TOTP 2FA for admin login.** Add a TOTP secret to `User`, verify at `auth/login`. Small, meaningful
  hardening for an internet-exposed panel.
- **[P2] Multi-user, organizations, and roles.** ZTNET's headline feature and the explicit v1 deferral
  (spec §11). `User.role`, the audit log, and API-key model were built to grow into this. Large — schedule
  as its own wave (auth middleware + every service authorization check + UI).
- **[P2] OIDC/SSO login.** For self-hosters this means Authelia/Authentik/Keycloak. Reasonable alongside (or
  before) full multi-user, as an alternative admin credential. Medium (`lib/services/auth.ts` + callback route).
- **[P3] Private root / custom planet (mkworld).** Generate a custom planet so nodes don't depend on
  ZeroTier's public roots — the "fully self-hosted" endgame. Large: binary tooling in the image + docs;
  the controller API gives no help here.

### Beyond ZTNET (UX & operator wins)
- **[P1] Config backup & restore.** One-click export of all controller network configs + members + GEM-ZT
  metadata (names/notes/rules source) as one JSON, and a restore that replays it against the controller API.
  Top operator anxiety with a self-hosted controller. Medium (new service over existing `networks`/`members`).
  (Pairs with the [P0] identity-backup issue in §2.)
- **[P1] Bulk member actions.** Checkbox selection → authorize / deauthorize / delete selected, and "delete
  members offline > N days" (zombie cleanup). Big time-saver after onboarding a batch. Small (`MemberTable`
  + loop over the existing member PATCH).
- **[P1] Inline validation & conflict feedback for routes/pools/DNS.** Warn on overlapping routes, pools
  outside any managed route, `via` gateways not inside the network, malformed DNS servers — before saving.
  `lib/util/cidr.ts` exists (and `RoutesEditor` already imports the unused `isValidCidr`). Prevents the classic
  "saved a broken route, network silently dead". Small.
- **[P2] Pending-member approval queue + shareable join page.** A cross-network "devices awaiting
  authorization" dashboard view, plus a per-network join page (network ID, per-OS `zerotier-cli join`
  instructions, QR) optionally carrying a time-limited self-authorize token. Onboarding becomes "send a link".
  Medium (new route group + token table).
- **[P2] Network templates / clone network.** Save a network's full config (settings/pools/routes/DNS/rule
  source) as a named template; create-from-template or clone. Operators redo the same setup per project.
  Small-medium (template model + reuse of the create path).
- **[P2] Member presence history / last-seen timeline.** A lightweight poller sampling the `/peer` data
  already read for live presence, persisted to SQLite, rendered as a per-member sparkline + "last seen 3d ago".
  Answers "when did this node drop off?" — which nothing (including the controller API) answers today.
  Medium (poller + table + UI).
- **[P2] Flow-rule change preview + audit diffs.** Show a compiled-JSON diff (old vs new) before committing
  rule changes, and store before/after in `AuditLog.detail` so the audit view renders real diffs for rules,
  routes, and settings. Flow rules are the easiest way to lock yourself out; a diff is cheap insurance.
  Small (compiler + audit plumbing already exist).
- **[P3] Prometheus metrics + status dashboard.** `/api/v1/metrics` exposing controller reachability,
  network/member counts, authorized-vs-pending, per-member online. Be honest in docs: the controller API
  exposes no per-member traffic/bandwidth, so this is liveness + inventory, not usage accounting. Small-medium.
- **[P3] Visual flow-rule builder.** Block-based editor (source/dest/port/action rows) that emits rule-language
  source, alongside the text editor, with a starter-preset library (default allow, isolate-clients,
  expose-one-server). Makes ZeroTier's most powerful capability approachable; the vendored compiler gives
  round-trip validation. Large (`components/networks/RulesEditor.tsx`).
