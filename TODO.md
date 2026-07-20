# GEM-ZT — TODO

Working backlog for GEM-ZT. v1 (32 tasks) is merged to `master` and runs in Docker
via `docker compose up -d --build`. Completed items live in
[`Completed_TODO.md`](Completed_TODO.md).

Everything remaining is organized into **phases**, ordered by priority (Phase 1 first).
Within a phase, items are ordered roughly quickest → largest. Stable IDs are kept where
other docs reference them: `AUD-xx` (2026-07-19 audit), `I-x` (ZTNET release-note ideas),
`M4` (PM request). Effort in parens: S/M/L/XL.

> **Reorg note (2026-07-20):** this file previously listed the same work three times
> (Prioritized backlog + Execution order + ZTNET ideas) plus a separate audit list. Those
> were merged into the phases below. De-duplications: **I4** (responsive/mobile) folded into
> **AUD-13**; the "background scheduler" need (was repeated across the email, presence, and
> real-time items) is now the single foundation of **Phase 3**; positional `#n` backlog
> numbers were dropped in favor of the phase ordering.

## Recently completed

> Moved to `Completed_TODO.md` on 2026-07-20: **OIDC/SSO login** and the entire **P0 audit
> set** — **AUD-01** (dark-theme contrast / `Pill` primitive), **AUD-02** (`createOrg`
> atomicity), **AUD-03** (last-owner TOCTOU), **AUD-04** (controller fan-out cap), **AUD-05**
> (backup-restore continue-on-error).

> Moved to `Completed_TODO.md` on 2026-07-17: **Multi-user, organizations & roles**, **M1**
> (member UX speed), **M3** + **M8** (accepted-field chip validation), **M5** (network-detail
> layout), **M7** (ZTNET release-note mining), the **backup/restore `rulesSource`** guard,
> **M9** (clear-on-accept + red-X remove), the **pending-queue polish** (self-authorize join
> tokens + QR), **M2** (standalone account management), **I5** (duplicate managed-route
> rejection), **I6** (runtime rate-limit settings), and **M6** (admin controller status/settings).

> **Audit baseline (2026-07-19):** four parallel audits (security, reliability, UI/UX + a11y,
> functional). Verdict: healthy codebase — builds, type-checks (0 errors), lints clean, no
> CRITICAL security issues, no stub/broken features, no schema drift. The P0 set is done (above);
> the rest is distributed across the phases below. Plan doc:
> [`docs/superpowers/plans/2026-07-19-audit-top-priority-fixes.md`](docs/superpowers/plans/2026-07-19-audit-top-priority-fixes.md).

---

## Phase 1 — Harden shipped code: reliability & security

The highest priority: correctness and security defects in code already running in production.
Mostly small, surgical fixes.

- **AUD-16 [FN]** (S) — `setup-auth-routes.test.ts` fails against a populated local `.env`: it
  never scrubs a real `GEMZT_SETUP_TOKEN`. Add the same `beforeAll`/`afterAll` scrub that
  `tests/integration/totp-login.test.ts:11-17` already uses. Clean `.env.example` checkout passes 9/9.
- **AUD-10 [REL]** (S) — `runRetention()` is awaited inline in the login hot path
  (`app/api/v1/auth/login/route.ts:64`), adding a latency spike. Make it fire-and-forget:
  `void runRetention().catch(…)`.
- **AUD-06 [REL]** (S–M) — Setup first-run TOCTOU: `userCount() > 0` is checked non-atomically
  (`app/api/v1/setup/route.ts:53-57`); concurrent first-run requests can mint two super-admins,
  and `P2002` falls through to a generic 500. Make the check+create atomic and map `P2002` to
  `SETUP_ALREADY_COMPLETE`.
- **AUD-08 [REL]** (S–M) — Unbounded row growth: `runRetention` (`lib/services/retention.ts:19-31`)
  purges sessions/audit/presence but not expired invitations or join tokens. Add them to the purge.
- **AUD-09 [REL]** (M) — `getNetworkPresence` does 2N sequential queries on the single SQLite
  connection (`lib/services/presence.ts:87-102`); 500 members = 1000 serialized queries blocking
  other writers. Replace the per-member fan-out with set-based queries.
- **AUD-07 [REL]** (M) — Webhook delivery is at-least-once with no idempotency key
  (`lib/services/webhooks.ts:127-160`): the "known" set is saved only after the dispatch loop, so
  process death mid-loop re-fires to already-notified members; payload carries no event id. Persist
  "known" before dispatch and add an event id. (Carries into the Phase 3 notifications work.)
- **AUD-14 [SEC]** (M) — TOTP replay within the 30s window (`lib/services/totp.ts:82-89`): no
  per-user last-used counter, so a captured code is reusable in its ±1-step window. Store and reject
  `totpLastUsedCounter <= stored`.
- **AUD-15 [SEC]** (M) — No brute-force throttle on TOTP enable/disable
  (`app/api/v1/auth/totp/enable|disable/route.ts`). Add a per-user limiter keyed by user id.
  (Requires a pre-compromised session to exploit, so lowest within this phase.)

## Phase 2 — UX correctness & accessibility baseline

P1 UI defects: users currently hit dead ends or can't use the app at all on some surfaces.

- **AUD-11 [UI]** (S–M) — Two pages hang on "Loading…" forever with no error state:
  `app/(ui)/account/page.tsx` swallows the fetch error (`.catch(() => {})`) and
  `app/(ui)/docs/page.tsx:29` has no `isError` branch. Add error states.
- **AUD-12 [UI]** (M) — No danger/error color token: errors render in body-text color and
  destructive buttons (Delete/Revoke/Deny/Remove) have no danger affordance. Add a `danger` token to
  `lib/design/tokens.ts` + a destructive `Button` variant. (Unblocks AUD-19/AUD-30 polish.)
- **AUD-13 / I4 [UI]** (L) — No mobile/responsive layout: fixed 272px sidebar, no hamburger
  (`components/Sidebar.tsx:130`, `app/(ui)/layout.tsx`), contradicting DESIGN.md (448-466); app is
  unusable below ~768px. Includes the ZTNET **I4** scope: responsive member table + a PWA/service
  worker (ZTNET v0.8.0/v0.8.2). **[merged: I4]**

## Phase 3 — Notifications, background scheduler & real-time

These three share one foundation — **a real background scheduler**. Today, notifications, presence,
and metrics only advance while a relevant page is open. Build the scheduler once, then layer:

- **Email + webhook notifications** (M–L) — Webhook slice for "new unauthorized member" is done
  (`lib/services/webhooks.ts`). Still open: SMTP email with **STARTTLS** (ZTNET v0.7.14, **I7**),
  more events (deauthorized, controller degraded), and firing on the scheduler instead of on page
  view. Fold in the **AUD-07** idempotency key here. **[merged: I7, AUD-07 follow-through]**
- **Presence history / metrics depth** (M–L) — Both features are live but sampled opportunistically;
  the scheduler makes "offline > N days" bulk-select and between-visit metrics accurate.
- **I1 — Real-time live updates (WebSocket/SSE)** (M–L) — GEM-ZT still polls (default 30s), the one
  remaining caveat on completed M1. A push channel makes status/values instant and complements the
  scheduler.

## Phase 4 — Scale & network-members overhaul

- **I2 — Row virtualization + database-first member sync** (M–L) — ZTNET v0.8.0 cited faster loading
  for large networks; GEM-ZT deferred virtualization during M1. Worthwhile once a network has
  hundreds of members.
- **M4 — Network members design + function overhaul** (L) — Redesign the network/members page taking
  inspiration from ZTNET's showcase; add the functions shown there.
  Refs: <https://github.com/sinamics/ztnet/blob/main/docs/images/showcase/network_local.jpg>,
  <https://github.com/sinamics/ztnet/blob/main/docs/images/showcase/member_options.jpg>.

## Phase 5 — Polish & housekeeping

Lower-risk quality items from the P2/P3 audit tiers. Do opportunistically; several are quick wins
once Phase 2's tokens/primitives exist.

**Security**
- **AUD-17 [SEC]** (S) — `GEMZT_TRUST_PROXY` defaults to `true` (`lib/api/net.ts:14-25`); direct
  exposure lets an attacker rotate `X-Forwarded-For` to defeat IP-based limits. Consider
  secure-by-default `false` or auto-disable on loopback/private `remoteAddress`.
- **AUD-18 [SEC]** (S) — Dev-only CVEs in `vitest`/`vite`/`esbuild` (GHSA-5xrq-8626-4rwp), lockfile
  only, not in the production image. Bump `vitest` to `^4.x`; never bind Vitest UI to `0.0.0.0`.
- **AUD-26 [SEC]** (M) — DNS-rebinding gap in the webhook SSRF guard (`lib/util/ssrf.ts`,
  `lib/services/webhooks.ts:80-102`): resolve + re-validate the host before `fetch`. Admin-only
  vector — only if the threat model expands to untrusted org-admins.

**UI / accessibility**
- **AUD-22 [UI]** (S) — Invalid `<a><button>` nesting (`NetworkActions.tsx:69-71`); render as a
  button-styled `<Link>`.
- **AUD-24 [UI]** (S) — Admin nav links lack active state (`components/AdminNavLink.tsx:26-45`); reuse
  `NavItem`.
- **AUD-25 [UI]** (S) — Nested network page wayfinding (`app/(ui)/networks/[nwid]/page.tsx:14`): `<h1>`
  is literally "Network" — add the name + a breadcrumb/back-link.
- **AUD-27 [UI]** (S) — `animate-pulse` ignores `prefers-reduced-motion` (`components/ui/Skeleton.tsx:9`);
  gate with `motion-safe:`.
- **AUD-28 [UI]** (S) — Unlabeled nav landmark + no skip link (`Sidebar.tsx:136`, `app/(ui)/layout.tsx`);
  add `aria-label="Primary"` + a visually-hidden skip-to-content link.
- **AUD-30 [UI]** (S) — No success confirmation for 2FA enable/disable (`components/TotpSettings.tsx`) +
  copy inconsistencies ("My Account" vs "Account", "Loading..." vs "Loading…").
- **AUD-32 [FN]** (S) — Lint: 3 `no-img-element` warnings on QR data-URI `<img>` tags
  (`JoinInstructions.tsx:161`, `JoinLinkPanel.tsx:147`, `TotpSettings.tsx:113`); advisory.
- **AUD-21 [UI]** (S–M) — Missing focus-visible rings on selects/textareas/cards (`Input.tsx:9`,
  `selectClass` in `NetworkList.tsx:18` & `MemberTable.tsx:464`, textareas in `RulesEditor.tsx:143` &
  `DnsEditor.tsx:102`) — WCAG 2.4.7. Add `focus-visible:ring-2`.
- **AUD-23 [UI]** (S–M) — Org switch does a full `window.location.reload()` (`components/OrgSwitcher.tsx:50`);
  use `queryClient.invalidateQueries()` / `router.refresh()`.
- **AUD-20 [UI]** (M) — Inconsistent loading UX: skeletons on some surfaces, plain "Loading…" on many
  others (`NetworkSettings`, `RoutesEditor`, `DnsEditor`, `RulesEditor`, `audit`, `apikeys`, `account`,
  `docs`, `RateLimitSettings`). Extend the `Skeleton` primitive.
- **AUD-19 [UI]** (M) — Inconsistent destructive confirmation: native `window.confirm`
  (`MemberTable.tsx:230,582`, `apikeys/page.tsx:72`, `PendingMembers.tsx:73`) vs the polished
  type-the-nwid gate (`NetworkActions.tsx:117-132`). Standardize on one in-app dialog. (Depends on the
  AUD-12 danger variant.)
- **AUD-29 [UI]** (M) — Extract remaining ad-hoc UI into `components/ui/`: `PresencePill` is defined
  twice; `selectClass`/textarea classes are duplicated; no `Select`/`Textarea` primitives.
  (`StatusPill`/`Pill` already extracted in the P0 pass.)

**Reliability**
- **AUD-31 [REL]** (M) — Housekeeping bundle: in-memory throttle maps not pruned on network deletion
  (`networks/[nwid]/members/route.ts:16,38`); `applySqlitePragmas` silent-fail
  (`lib/db/client.ts:38-40`); `diffJsonLines` O(n·m) on large rule sets (`lib/util/jsonDiff.ts`);
  `cidrToPool` raw-throws on unvalidated input (`lib/util/cidr.ts:160`).

## Phase 6 — Longer-term / larger bets

Big-effort features and risky upgrades; schedule deliberately.

- **Visual flow-rule builder** (L) — Block-based editor (source/dest/port/action rows) emitting
  rule-language source alongside the text editor, with a starter-preset library (default-allow,
  isolate-clients, expose-one-server). The vendored compiler gives round-trip validation.
  (`components/networks/RulesEditor.tsx`).
- **I3 — Internationalization (i18n)** (L) — GEM-ZT is English-only; ZTNET ships many languages.
  Introduce a message catalog + locale switch across the UI.
- **Prisma 5.22 → 7.x major upgrade** (L / risky) — Optional; follow the migration guide.
  (Currently `^5.16.0`.)
- **Private root / custom planet (mkworld)** (XL) — Generate a custom planet so nodes don't depend on
  ZeroTier's public roots — the "fully self-hosted" endgame. Binary tooling in the image + docs; the
  controller API gives no help here.
