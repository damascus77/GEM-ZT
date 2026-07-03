# GEM-ZT — TODO

Working backlog for GEM-ZT. v1 (32 tasks) is merged to `master` and runs in Docker
via `docker compose up -d --build`. This file tracks what's left.

Legend: **[P0]** blocker / do now · **[P1]** important · **[P2]** nice-to-have.

---

## 1. Tracked engineering follow-ups (already known)

These were logged during the build/review and the Docker bring-up. None block running
v1 today, but each is worth closing.

### Correctness / resilience
- ✅ **[DONE] [P1]** ~~Controller auth failure maps to a generic 500, not the degraded UI.~~
  *(Fixed: `handleRouteError` maps controller `401`/`403` to a 502 degraded response so the banner
  trips; `DegradedBanner` now surfaces the server's specific reason. `lib/api/errors.ts`,
  `components/DegradedBanner.tsx`.)*
- ✅ **[DONE] [P1]** ~~`getControllerClient()` caches the token forever.~~ *(Fixed: added
  `invalidateControllerClient()`, called on a controller `401`/`403` so the next request re-reads
  the token — recovers from a rotated `authtoken.secret` without a restart. `lib/controller/index.ts`.)*
- ✅ **[DONE] [P2]** ~~`login()` user-enumeration timing side-channel.~~ *(Fixed: an unknown username
  now verifies against a constant dummy argon2 hash so timing doesn't leak user existence.
  `lib/services/auth.ts`.)*
- ✅ **[DONE] [P2]** ~~`listAuditLog` orders by `createdAt` only~~ *(Fixed: `orderBy:
  [{createdAt:'desc'},{id:'desc'}]`. `lib/services/audit.ts`.)*
- ✅ **[DONE] [P2]** ~~API-key date-only expiry shifts by timezone.~~ *(Fixed: `dateInputToEndOfDayIso`
  interprets the picked date as end-of-local-day. `lib/util/date.ts`, `app/(ui)/apikeys/page.tsx`.)*
- ✅ **[DONE] [P2]** ~~`requireAuth` is case-sensitive on the `Bearer ` scheme~~ *(Fixed: scheme
  parsed case-insensitively per RFC 7235; token stays case-sensitive. `lib/api/auth.ts`.)*

### Tooling / CI / deps
- ✅ **[DONE] [P1]** ~~Add `typecheck` + lint scripts and wire into CI.~~ *(Done: `typecheck`/`lint` scripts,
  `.eslintrc.json` (next/core-web-vitals), all tsc nits cleaned, `.gitlab-ci.yml` runs typecheck+lint+test.)*
- ✅ **[DONE] [P1]** ~~Actually run the CI-gated e2e + `docker compose build` in CI.~~ *(Done: `.gitlab-ci.yml`
  has an `e2e` job (DinD, `allow_failure`) and a `docker-build` job (`docker build`, `allow_failure`).)*
- ⚠️ **[PARTIAL] [P2] Bump `next`** — bumped to the latest **14.2.35** patch (picks up 31 patch releases),
  but the npm-audit CVEs are NOT cleared on 14.2.x: they require a **Next 15/16 major upgrade** (see new item
  below). Kept the harmless patch bump; tests green.
- **[P2] Next 14 → 15/16 major upgrade** to clear the outstanding `next` security advisories (App Router
  breaking changes — schedule as its own task; too large for a one-shot).
- **[P2] Prisma 5.22 → 7.x** major upgrade available. Optional; follow the migration guide if taken.
  *(Deferred — large/risky, not attempted this pass.)*

### Cleanup
- ✅ **[DONE] [P2]** ~~Remove dead `isValidCidr` import~~ in `components/networks/RoutesEditor.tsx` and
  ~~the stray `eslint-disable @typescript-eslint/no-var-requires`~~ above an ES `import` in
  `lib/rules/compiler.ts`. *(Both removed.)*
- ✅ **[DONE] [P2]** ~~Extract a `useNetworkDetail(nwid)` hook.~~ *(Done: `components/networks/
  useNetworkDetail.ts`, now used by `NetworkSettings`, `RoutesEditor`, and `DnsEditor`.)*

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

**Still open — the larger efforts left:** Next 14→15/16 major upgrade (clears audit CVEs), Prisma 5→7,
multi-user/orgs/roles, OIDC/SSO, private root / custom planet (mkworld), the visual flow-rule builder,
and SMTP email + a background notification scheduler. *(A large tooling/security/feature wave landed
2026-07-04 — CI+lint+typecheck, multi-stage Docker, backup/restore, TOTP 2FA, per-member tags/caps,
pending queue + join page, presence history, rules/audit diffs, metrics dashboard, new-member webhook,
per-IP login limiting — see the ✅ items throughout §1–§3.)*

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
- ✅ **[DONE] [P2]** ~~SQLite + Prisma default pool → intermittent "database is locked" under concurrent
  writes.~~ *(Fixed: `getDb()` forces `connection_limit=1` and applies WAL + `busy_timeout=5000` +
  `synchronous=NORMAL` pragmas on init. `lib/db/client.ts`)*
- ✅ **[DONE] [P2]** ~~Expired sessions and audit rows are never purged.~~ *(Fixed: `purgeExpiredSessions()`
  + `purgeAuditLogsOlderThan(cutoff)`, run via a self-throttled `runRetention()` wired into the login
  route. Retention window: `GEMZT_AUDIT_RETENTION_DAYS` (default 90). `lib/services/retention.ts`)*

### Controller integration
- ✅ **[DONE] [P1] Member list is N+1 against the controller every 5s per open tab.** *(Fixed: `mapWithConcurrency` caps per-member GETs at 8; poll interval 5s→10s. The per-member GET count is inherent — no bulk controller endpoint — but bursts are bounded.)* `listMembers` fires an
  unbounded parallel `getMember` per member + a full `/peer` fetch (`lib/services/members.ts`), on a 5s
  `refetchInterval` — ~100 members ≈ ~100 controller requests per poll per tab, and `updateMember` re-runs
  `loadContext` after every write. Cache peers, batch, or lengthen the interval.
- ✅ **[DONE] [P2]** ~~PATCH to a nonexistent member silently creates it on the controller.~~ *(Fixed:
  `updateMember` GET-firsts so a typo'd memberId 404s instead of minting a phantom. `lib/services/members.ts`)*
- ✅ **[DONE] [P2]** ~~`nwid`/`memberId` params are never format-validated and are interpolated into
  controller URLs.~~ *(Fixed: `ControllerClient` validates `^[0-9a-f]{16}$` / `^[0-9a-f]{10}$` before every
  request; `InvalidControllerIdError` → 400. `lib/controller/client.ts`, `lib/api/errors.ts`)*

### Security & auth
- ✅ **[DONE] [P1] First-boot (and post-DB-loss) admin takeover: `/setup` is open to whoever reaches port 3000 first.**
  *(Fixed: optional `GEMZT_SETUP_TOKEN` — when set, `/setup` requires it. Reverse-proxy guidance in README.)*
  The only gate is `userCount() > 0` (`app/api/v1/setup/route.ts`), and compose publishes `3000` on all
  interfaces. If the box is reachable beyond the operator — or `app_data` is ever lost (silently resetting
  to `needsSetup`) — someone else becomes admin of the real controller. Gate setup with a bootstrap-token env
  var or bind `127.0.0.1:3000` by default. (`docker-compose.yml`)
- ✅ **[DONE] [P2]** ~~Session tokens are Prisma `cuid()`, not CSPRNG.~~ *(Fixed: `createSession` issues a
  256-bit `randomBytes` hex token as the session id. `lib/services/auth.ts`)*
- ✅ **[DONE] [P2]** ~~Session cookie lacks `Secure`~~ *(Fixed: `sessionCookieOptions()`/`clearSessionCookieHeader()`
  set `Secure` when `GEMZT_COOKIE_SECURE=true`, used across login/setup/logout. Reverse-proxy TLS docs still
  worth expanding in README. `lib/services/auth.ts`)*
- ✅ **[DONE] [P2]** ~~No login rate limiting.~~ *(Fixed: in-memory per-username failed-login limiter →
  429 + `Retry-After` after `GEMZT_LOGIN_MAX_ATTEMPTS` (default 5) failures per `GEMZT_LOGIN_WINDOW_MS`
  (default 15m); resets on success. `lib/services/rateLimit.ts`, `app/api/v1/auth/login`)*

### Deployment & ops
- ✅ **[DONE] [P2] No healthchecks; `depends_on` is start-order only.** *(Fixed: controller healthcheck on
  `authtoken.secret` + app `depends_on: condition: service_healthy`; app healthcheck hits
  `/api/v1/setup/status` via Node's global fetch. `docker-compose.yml`)*
- ✅ **[DONE] [P2]** ~~Single-stage image ships devDependencies + source and runs as root.~~ *(Fixed: Next
  standalone multi-stage `Dockerfile` running `USER node`; `output:'standalone'` in next.config; a
  `docker-entrypoint.sh` runs `prisma migrate deploy` then `node server.js`; non-root operators set
  `ZT_AUTH_TOKEN` per the documented note. NOT built here — no Docker in the dev env.)*

### UX / error-handling
- ✅ **[DONE] [P1] Stale "Managed IPs" input can wipe a member's auto-assigned IP.** *(Fixed: `MemberRow` re-seeds
  from the server unless mid-edit, and re-syncs after save.)* The input previously seeded once at mount and
  never reflected later server changes (`components/members/MemberTable.tsx`). Flow: authorize → controller
  auto-assigns an IP → input still shows the old list → "Save IPs" PATCHes the stale list, deleting the live
  assignment. Re-seed when server data changes (or diff before save).
- ✅ **[DONE] [P1] Authorize / Deauthorize / Save IPs / Remove failures are silent.** *(Fixed: `MemberRow` renders a
  `role="alert"` row showing the mutation error. Follow-up also done: the Remove/DELETE path now parses the
  response body's `error.message` instead of a fixed "Delete failed".)*
- ✅ **[DONE] [P2] Settings/Routes/DNS editors seed once and save whole stale snapshots.** *(Fixed: all three
  editors now re-seed from the server when it changes and the field is untouched (dirty-flag guard, like the
  member IP input), so a tab left open no longer reverts external edits on save. `components/networks/*`)*
- ✅ **[DONE] [P2] No delete-network control in the UI, and member "Remove" has no confirmation.** *(Fixed:
  `NetworkActions` adds a danger-zone Delete (type-the-nwid confirm) that calls `DELETE /networks/{nwid}`;
  member "Remove" now confirms first, individually and in bulk. `components/networks/NetworkActions.tsx`,
  `components/members/MemberTable.tsx`)*

## 3. Feature roadmap (review)

Tags here: **[P1]** high-value / expected of a ZTNET alternative · **[P2]** valuable enhancement ·
**[P3]** longer-term / larger effort.

### ZTNET-parity features
- ✅ **[DONE] [P1] Member tags & capabilities UI.** *(Done: `capabilityTagMaps()` parses name→id maps from the
  rules source, surfaced via GET /networks/{nwid}/rules; `MemberTable` renders per-member capability checkboxes
  + tag value inputs and PATCHes capabilities/tags.)*
- ✅ **[DONE] [P1] Member search, filter, and sort.** *(Done: `lib/util/memberFilter.ts` + a toolbar in
  `MemberTable` — free-text name/ID/IP search, authorized/pending + online/offline filters, and column
  sort. NetworkList search also done — `lib/util/networkFilter.ts`.)*
- **[P1] IPv4/IPv6 assign-mode toggles + full per-member controls.** UI for `v4AssignMode.zt`, `v6AssignMode`
  (`zt`/`6plane`/`rfc4193`) in `NetworkSettings` — *(network-level v4/v6 toggles already shipped in
  `RoutesEditor`)*. ✅ Per-member `noAutoAssignIps`/`activeBridge` toggles now render in `MemberTable`.
- ✅ **[DONE] [P1] Dark mode.** *(Done 2026-07-03: CSS-variable theming — neutral tokens flip under a `.dark`
  class; defaults to dark with a no-flash inline script + `localStorage` toggle in the sidebar/auth screen.
  Palette may want visual tuning — the `.dark` values live in `app/globals.css`.)*
- ⚠️ **[PARTIAL] [P2] Email + webhook notifications.** *(Webhook slice done: `lib/services/webhooks.ts` fires
  a JSON webhook on "new unauthorized member appeared", configurable via GET/PUT /api/v1/settings/webhook,
  triggered opportunistically from the members-list route. STILL OPEN: SMTP email, more events
  (deauthorized / controller degraded), and a background scheduler — currently only fires while a member
  list is being viewed.)*
- ✅ **[DONE] [P2] TOTP 2FA for admin login.** *(Done: dependency-free RFC 6238 TOTP (`lib/services/totp.ts`),
  `User.totpSecret`/`totpEnabled` + migration, enroll/enable endpoints, and enforcement at `/auth/login`
  — no session issued until the code verifies.)*
- **[P2] Multi-user, organizations, and roles.** ZTNET's headline feature and the explicit v1 deferral
  (spec §11). `User.role`, the audit log, and API-key model were built to grow into this. Large — schedule
  as its own wave (auth middleware + every service authorization check + UI).
- **[P2] OIDC/SSO login.** For self-hosters this means Authelia/Authentik/Keycloak. Reasonable alongside (or
  before) full multi-user, as an alternative admin credential. Medium (`lib/services/auth.ts` + callback route).
- **[P3] Private root / custom planet (mkworld).** Generate a custom planet so nodes don't depend on
  ZeroTier's public roots — the "fully self-hosted" endgame. Large: binary tooling in the image + docs;
  the controller API gives no help here.

### Beyond ZTNET (UX & operator wins)
- ✅ **[DONE] [P1] Config backup & restore.** *(Done: `lib/services/backup.ts` — `exportBackup()` →
  GET /api/v1/backup (JSON download) and `restoreBackup()` → POST /api/v1/backup/restore (replays networks,
  members, meta, rules; updates existing networks in place, recreates missing ones, skips un-joined members).
  `BackupControls` on the networks page. Note: an existing network with compiled rules but no stored
  rulesSource won't re-push rules on restore — edge case, low-risk.)*
- ✅ **[DONE] [P1] Bulk member actions.** *(Done: checkbox selection + select-all → authorize / deauthorize /
  delete selected in `MemberTable`, plus a "Select offline" quick-select for cleanup. True "offline > N days"
  needs last-seen history — see the presence-history item below.)*
- ✅ **[DONE] [P1] Inline validation & conflict feedback for routes/pools/DNS.** *(Done:
  `lib/util/networkValidation.ts` warns on overlapping routes, pools outside every managed route, `via`
  gateways not inside a route, and malformed DNS servers — surfaced advisorily in `RoutesEditor`/`DnsEditor`.)*
- ✅ **[DONE] [P2] Pending-member approval queue + shareable join page.** *(Done: `/pending` dashboard
  aggregates unauthorized members across all networks with authorize/deny (`lib/services/pending.ts` +
  GET /api/v1/pending); per-network `/networks/{nwid}/join` page with per-OS `zerotier-cli join` commands +
  copy buttons. STILL OPEN: QR code and the time-limited self-authorize token (deferred to avoid a QR dep /
  a token table).)*
- ✅ **[DONE] [P2] Network templates / clone network.** *(Done: `cloneNetwork()` + `POST /networks/{nwid}/clone`
  + "Clone network" button. Named templates also done — `NetworkTemplate` model (+ migration
  `20260704120000_add_network_template`), `lib/services/templates.ts`, `/api/v1/templates[/{id}[/apply]]`,
  "Save as template" in `NetworkActions` + a Templates list on the networks page.)*
- ✅ **[DONE] [P2] Member presence history / last-seen timeline.** *(Done: `MemberPresence` model + migration,
  `lib/services/presence.ts` (opportunistic throttled sampler wired into the members-list route, retention via
  runRetention), GET /networks/{nwid}/presence, and per-member "last seen" + a div-based sparkline in
  `MemberTable`. Honest limitation: samples only while a member list is being viewed — no background scheduler.)*
- ✅ **[DONE] [P2] Flow-rule change preview + audit diffs.** *(Done: `lib/util/jsonDiff.ts` LCS diff; RulesEditor
  "Preview changes" shows live-vs-compiled rules diff before save; network/member/rules update routes store
  `{before, after}` in `AuditLog.detail` and the audit page renders the diff.)*
- ✅ **[DONE] [P3] Prometheus metrics + status dashboard.** *(Done: `GET /api/v1/metrics` (text exposition)
  via `lib/services/metrics.ts`, plus a `/status` dashboard page (`StatusDashboard` parses the metrics text)
  showing controller reachability + inventory counts. Liveness + inventory only — no per-member traffic.)*
- **[P3] Visual flow-rule builder.** Block-based editor (source/dest/port/action rows) that emits rule-language
  source, alongside the text editor, with a starter-preset library (default allow, isolate-clients,
  expose-one-server). Makes ZeroTier's most powerful capability approachable; the vendored compiler gives
  round-trip validation. Large (`components/networks/RulesEditor.tsx`).
