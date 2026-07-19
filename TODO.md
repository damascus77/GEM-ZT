# GEM-ZT — TODO

Working backlog for GEM-ZT. v1 (32 tasks) is merged to `master` and runs in Docker
via `docker compose up -d --build`. Completed items have moved to
[`Completed_TODO.md`](Completed_TODO.md). This file tracks what's left, prioritized.

Legend: **[P0]** blocker / do now · **[P1]** important · **[P2]** nice-to-have · **[P3]** longer-term.

> **Audit findings (2026-07-19)** — recorded below under
> [Audit findings](#audit-findings-2026-07-19). Four parallel audits (security,
> reliability, UI/UX + a11y, functional). Plan for the top-priority items:
> [`docs/superpowers/plans/2026-07-19-audit-top-priority-fixes.md`](docs/superpowers/plans/2026-07-19-audit-top-priority-fixes.md).

> Moved to `Completed_TODO.md` on 2026-07-17: **Multi-user, organizations & roles**,
> **M1** (member UX speed), **M3** + **M8** (accepted-field chip validation, IPv4 then IPv6),
> **M5** (network-detail layout), **M7** (ZTNET release-note mining), the **backup/restore
> `rulesSource`** guard/warning, **M9** (clear-on-accept + red-X remove + chip readability),
> the **pending-queue polish** (self-authorize join tokens + QR), and **M2** (standalone
> account management + sidebar reorg), **I5** (duplicate managed-route rejection), **I6**
> (runtime rate-limit settings), and **M6** (admin controller status/settings).

---

## Prioritized backlog

### P1 — high value, do next

1. **OIDC/SSO login.** For self-hosters this means Authelia/Authentik/Keycloak. A useful
   alternative admin credential now that full multi-user is shipped. Medium
   (`lib/services/auth.ts` + callback route). Not started — auth is local password + TOTP only.

### P2 — valuable, schedule opportunistically

2. **Prisma 5.22 → 7.x major upgrade.** Optional; follow the migration guide if taken.
   Deferred as large/risky. (Currently on `^5.16.0`.)
3. **Complete email + webhook notifications.** Webhook slice for "new unauthorized member" is
   done (`lib/services/webhooks.ts`). Still open: SMTP email (with STARTTLS — see I7), more
   events (deauthorized / controller degraded), and a real background scheduler — webhooks
   currently only fire while a member list is being viewed.

### P3 — longer-term / larger effort

4. **Private root / custom planet (mkworld).** Generate a custom planet so nodes don't depend
   on ZeroTier's public roots — the "fully self-hosted" endgame. Large: binary tooling in the
   image + docs; the controller API gives no help here.
5. **Visual flow-rule builder.** Block-based editor (source/dest/port/action rows) that emits
   rule-language source, alongside the text editor, with a starter-preset library (default
   allow, isolate-clients, expose-one-server). Makes ZeroTier's most powerful capability
   approachable; the vendored compiler gives round-trip validation. Large
   (`components/networks/RulesEditor.tsx`).
6. **Presence history / metrics depth.** Both features are live but sampling is opportunistic
   (only while a page is open) — a real background scheduler would make "offline > N days"
   bulk-select and metrics accurate between page visits. (Shares the scheduler need with #3.)

## Ideas from ZTNET release notes (via M7)

Mined from ZTNET's GitHub release history (v0.7.x–v0.8.x). New candidates not already
tracked above; triage into the P-buckets as they get scheduled.

- **I1 — Real-time live updates (WebSocket/SSE).** ZTNET v0.8.0 replaced polling with
  WebSocket-based live member updates. GEM-ZT still polls (default 30s), which is the one
  remaining caveat on the completed M1. A push channel would make status/values truly
  instant and would also satisfy the background-scheduler need behind #3 and #6. **[P2]**
- **I2 — Row virtualization + database-first member sync for large networks.** ZTNET v0.8.0
  cited faster loading for large networks; GEM-ZT deferred row virtualization during M1.
  Worthwhile once a network has hundreds of members. **[P2]**
- **I3 — Internationalization (i18n).** ZTNET ships many UI languages (German, Ukrainian, …).
  GEM-ZT is English-only. Introduce a message catalog + locale switch. **[P3]**
- **I4 — Responsive/mobile member table + PWA.** ZTNET v0.8.0 refactored the members table to
  be responsive and (v0.8.2) ships a PWA/service worker. GEM-ZT's wide table is desktop-first. **[P3]**
- **I7 — STARTTLS in SMTP email settings.** ZTNET v0.7.14 added STARTTLS. Fold into #3 when the
  SMTP email path is built. **[P2]**

## Added by Project Manager:

M4: design overhaul and fuction overhaul of network members. Take insiration from the link and redesign the network page. Functions available from these screenshots should be added. https://github.com/sinamics/ztnet/blob/main/docs/images/showcase/network_local.jpg, https://github.com/sinamics/ztnet/blob/main/docs/images/showcase/member_options.jpg

---

## Execution order — easiest/quickest → hardest/longest

Ordered across the whole remaining backlog (P-items + M-items + ZTNET ideas). Rough effort
in parens.

1. **#1 — OIDC/SSO login.** (M, `lib/services/auth.ts` + callback route + provider config).
2. **#3 + I7 — complete email + webhook notifications.** (M–L, SMTP w/ STARTTLS + more events
   - a real background scheduler).
3. **#6 + I1 — presence/metrics depth + real-time push.** (M–L, a background scheduler unblocks
   accurate presence/metrics; a WebSocket/SSE channel makes updates instant — shares the
   scheduler with #3).
4. **I2 — row virtualization + database-first member sync for large networks.** (M–L).
5. **M4 — network members design + function overhaul.** (L, redesign after the ZTNET showcase).
6. **#5 — visual flow-rule builder.** (L, block-based editor emitting rule source + presets).
7. **I3 — internationalization (i18n).** (L, message catalog + locale switch across the UI).
8. **I4 — responsive/mobile member table + PWA.** (L).
9. **#2 — Prisma 5 → 7 major upgrade.** (L / risky, follow the migration guide).
10. **#4 — private root / custom planet (mkworld).** (XL, binary tooling in the image + docs).

---

## Audit findings (2026-07-19)

Four parallel audits — **security**, **reliability**, **UI/UX + accessibility**, and
**functional/build**. Overall verdict: healthy codebase. It builds, type-checks (0 errors),
lints clean (3 cosmetic warnings), 741/748 tests pass, no CRITICAL security issues, no
stub/broken features, no schema drift. Findings below are IDs `AUD-xx`, tagged by domain
(SEC/REL/UI/FN) and priority. **Plan for the P0 set:**
[`docs/superpowers/plans/2026-07-19-audit-top-priority-fixes.md`](docs/superpowers/plans/2026-07-19-audit-top-priority-fixes.md).

### P0 — top priority (do now)

- **AUD-01 [UI] Status pills & diff text invisible in the default (dark) theme.**
  `text-teal-deep` (#0e3030) on `bg-canvas` (#1c1a2e) ≈ 1.1:1 contrast — far below WCAG 4.5:1.
  Hits the member table Online/Direct column, Status "Reachable", pending list, and rules/audit
  diff "added" lines. Dark is the default theme, so most users can't read the core status signal.
  `components/ui/AcceptedChip.tsx:15-18` already fixed this locally (`bg-teal-mid text-white`) but
  the fix was never generalized. Sites: `components/members/MemberTable.tsx:85,95`,
  `components/StatusDashboard.tsx:51`, `components/PendingMembers.tsx:24`,
  `components/networks/RulesEditor.tsx:177`, `app/(ui)/audit/page.tsx:39`.
- **AUD-02 [REL] `createOrg` is not atomic.** `organization.create` + `membership.create` are two
  separate awaits (`lib/services/orgs.ts:38-50`); a failure between them orphans an ownerless,
  unadministrable org. Siblings `deleteOrg`/`removeMember` already use `$transaction`. Fix: wrap
  both writes in one `$transaction`.
- **AUD-03 [REL] Last-owner guard is a TOCTOU race.** `ownerCount <= 1` is checked outside the
  write (`lib/services/orgs.ts:98-120`, `setMemberRole`/`removeMember`); two concurrent
  demotes/removes of different owners both pass and commit → org left with zero owners. Fix: move
  the count + conditional write into one transaction.
- **AUD-04 [REL] Unbounded controller fan-out in network-list paths.**
  `lib/services/networks.ts:165,203,257` do `Promise.all(ids.map(...))` (2 controller GETs each,
  no cap); every other fan-out caps at 8 via `mapWithConcurrency`. 100 networks = 200 simultaneous
  controller GETs per dashboard load. Fix: route through `mapWithConcurrency(ids, 8, …)`.
- **AUD-05 [REL] Backup restore is non-idempotent and leaves partial state.**
  `lib/services/backup.ts:200-284` matches by controller-assigned nwid, so re-running mints
  duplicate networks; a non-404 controller error aborts mid-restore, leaving everything applied so
  far. Fix: continue-on-error with per-item warnings (as already done for 404s); document that
  restore is not idempotent once nwids change.

### P1 — important, do next

- **AUD-06 [REL] Setup first-run TOCTOU.** `userCount() > 0` checked non-atomically
  (`app/api/v1/setup/route.ts:53-57`); concurrent first-run requests can create two super-admins,
  and a `P2002` falls through to a generic 500 (no `SETUP_ALREADY_COMPLETE` mapping).
- **AUD-07 [REL] Webhook delivery is at-least-once with no idempotency key.**
  `lib/services/webhooks.ts:127-160` — the "known" set is saved only after the dispatch loop, so
  process death mid-loop re-fires to already-notified members; payload carries no event id.
- **AUD-08 [REL] Unbounded row growth.** `runRetention` (`lib/services/retention.ts:19-31`) purges
  sessions/audit/presence but not expired invitations or join tokens; they accumulate forever.
- **AUD-09 [REL] `getNetworkPresence` — 2N sequential queries on the single SQLite connection**
  (`lib/services/presence.ts:87-102`); 500 members = 1000 serialized queries, blocking other
  writers. Fix: replace per-member fan-out with set-based queries.
- **AUD-10 [REL] `runRetention()` awaited inline in the login hot path**
  (`app/api/v1/auth/login/route.ts:64`) — adds a latency spike to one login/hour. Fix:
  fire-and-forget (`void runRetention().catch(…)`).
- **AUD-11 [UI] Two pages hang on "Loading…" with no error state.** `app/(ui)/account/page.tsx`
  swallows the fetch error (`.catch(() => {})`); `app/(ui)/docs/page.tsx:29` has no `isError`
  branch. Any transient failure = indefinite spinner.
- **AUD-12 [UI] No danger/error color token.** Errors render in body-text color (`text-ink`)
  everywhere; destructive buttons (`Delete`, `Revoke`, `Deny`, `Remove`) have no danger affordance.
  `lib/design/tokens.ts` defines no error color. Fix: add a `danger` token + destructive `Button`
  variant.
- **AUD-13 [UI] No mobile/responsive layout.** Fixed 272px sidebar, no hamburger
  (`components/Sidebar.tsx:130`, `app/(ui)/layout.tsx`), contradicting DESIGN.md (lines 448-466).
  App is unusable below ~768px. (Overlaps ZTNET idea **I4**.)
- **AUD-14 [SEC] TOTP replay within the 30s window.** `lib/services/totp.ts:82-89` has no per-user
  last-used counter; a captured valid code can be reused within its ±1-step window. Fix: store and
  reject `totpLastUsedCounter <= stored`.
- **AUD-15 [SEC] No brute-force throttle on TOTP enable/disable.**
  `app/api/v1/auth/totp/enable|disable/route.ts` have no rate limiter around the code/password
  check (requires a pre-compromised session to exploit). Fix: per-user limiter keyed by user id.
- **AUD-16 [FN] `setup-auth-routes.test.ts` fails against a populated local `.env`.** 6 failures
  are environmental: local `.env` sets a real `GEMZT_SETUP_TOKEN` the test never scrubs; sibling
  `tests/integration/totp-login.test.ts:11-17` does. Clean `.env.example` checkout passes 9/9.
  Fix: add the same `beforeAll`/`afterAll` token scrub to that one test file.

### P2 — valuable, opportunistic

- **AUD-17 [SEC] `GEMZT_TRUST_PROXY` defaults to `true`** (`lib/api/net.ts:14-25`). Direct
  internet exposure without a trusted proxy lets an attacker rotate `X-Forwarded-For` to defeat
  IP-based rate limits (per-username limiter still applies). Consider secure-by-default `false` or
  auto-disable on loopback/private `remoteAddress`.
- **AUD-18 [SEC] Dev-only dependency CVEs.** `vitest`/`vite`/`esbuild` critical CVEs
  (GHSA-5xrq-8626-4rwp) in the lockfile — dev/CI only, not in the production image. Bump `vitest`
  to `^4.x`; never bind Vitest UI to `0.0.0.0`.
- **AUD-19 [UI] Inconsistent destructive confirmation.** Native `window.confirm`
  (`MemberTable.tsx:230,582`, `apikeys/page.tsx:72`, `PendingMembers.tsx:73`) vs the polished
  type-the-nwid gate (`NetworkActions.tsx:117-132`). Standardize on one in-app dialog.
- **AUD-20 [UI] Inconsistent loading UX.** Skeletons on some surfaces, plain "Loading…" text on
  many others (`NetworkSettings`, `RoutesEditor`, `DnsEditor`, `RulesEditor`, `audit`, `apikeys`,
  `account`, `docs`, `RateLimitSettings`). Extend the `Skeleton` primitive.
- **AUD-21 [UI] Missing focus-visible rings** on selects/textareas/cards (`Input.tsx:9`,
  `selectClass` in `NetworkList.tsx:18` & `MemberTable.tsx:464`, textareas in `RulesEditor.tsx:143`
  & `DnsEditor.tsx:102`) — WCAG 2.4.7. Add `focus-visible:ring-2`.
- **AUD-22 [UI] Invalid `<a><button>` nesting** (`NetworkActions.tsx:69-71`) — double-focusable,
  ambiguous activation. Render as a button-styled `<Link>`.
- **AUD-23 [UI] Org switch does a full `window.location.reload()`** (`components/OrgSwitcher.tsx:50`)
  — white flash + lost scroll; use `queryClient.invalidateQueries()` / `router.refresh()`.
- **AUD-24 [UI] Admin nav links lack active state** (`components/AdminNavLink.tsx:26-45`) — reuse
  `NavItem`.
- **AUD-25 [UI] Nested network page wayfinding** (`app/(ui)/networks/[nwid]/page.tsx:14`) — `<h1>` is
  literally "Network", no name, no breadcrumb/back-link.

### P3 — polish / housekeeping

- **AUD-26 [SEC] DNS-rebinding gap in webhook SSRF guard** (`lib/util/ssrf.ts`,
  `lib/services/webhooks.ts:80-102`) — documented, admin-only vector; resolve+re-validate the host
  before `fetch` only if the threat model expands to untrusted org-admins.
- **AUD-27 [UI] `animate-pulse` ignores `prefers-reduced-motion`** (`components/ui/Skeleton.tsx:9`)
  — gate with `motion-safe:`.
- **AUD-28 [UI] Unlabeled nav landmark + no skip link** (`Sidebar.tsx:136`, `app/(ui)/layout.tsx`) —
  add `aria-label="Primary"` + a visually-hidden skip-to-content link.
- **AUD-29 [UI] Duplicated ad-hoc UI** — `PresencePill` defined twice, `selectClass`/textarea class
  duplicated; no `Select`/`Textarea`/`StatusPill` primitives. Extract into `components/ui/`.
- **AUD-30 [UI] No success confirmation for 2FA enable/disable** (`components/TotpSettings.tsx`) +
  minor copy inconsistencies ("My Account" vs "Account"; "Loading..." vs "Loading…").
- **AUD-31 [REL] Housekeeping:** in-memory throttle maps not pruned on network deletion
  (`networks/[nwid]/members/route.ts:16,38`); `applySqlitePragmas` silent-fail
  (`lib/db/client.ts:38-40`); `diffJsonLines` O(n·m) on large rule sets (`lib/util/jsonDiff.ts`);
  `cidrToPool` raw-throws on unvalidated input (`lib/util/cidr.ts:160`).
- **AUD-32 [FN] Lint: 3 `no-img-element` warnings** on QR-code data-URI `<img>` tags
  (`JoinInstructions.tsx:161`, `JoinLinkPanel.tsx:147`, `TotpSettings.tsx:113`) — advisory; `<img>`
  is arguably correct for data URIs.
