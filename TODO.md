# GEM-ZT — TODO

Working backlog for GEM-ZT. v1 (32 tasks) is merged to `master` and runs in Docker
via `docker compose up -d --build`. Completed items have moved to
[`Completed_TODO.md`](Completed_TODO.md). This file tracks what's left, prioritized.

Legend: **[P0]** blocker / do now · **[P1]** important · **[P2]** nice-to-have · **[P3]** longer-term.

> Moved to `Completed_TODO.md` on 2026-07-17: **Multi-user, organizations & roles**,
> **M1** (member UX speed), **M3** + **M8** (accepted-field chip validation, IPv4 then IPv6),
> **M5** (network-detail layout), **M7** (ZTNET release-note mining), the **backup/restore
> `rulesSource`** guard/warning, **M9** (clear-on-accept + red-X remove + chip readability),
> and the **pending-queue polish** (self-authorize join tokens + QR).

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
- **I5 — Prevent duplicate managed routes.** ZTNET v0.8.1 explicitly de-duped managed routes.
  GEM-ZT warns on overlaps but doesn't reject/merge exact duplicates on save
  (`lib/util/networkValidation.ts`, `components/networks/RoutesEditor.tsx`). **[P3]**
- **I6 — Configurable rate-limit options in settings.** ZTNET v0.7.14 made rate limiting
  configurable. GEM-ZT has a login limiter (`lib/services/rateLimit.ts`) and a self-authorize
  limiter driven only by env vars — surface window/attempts in an admin settings UI. **[P3]**
- **I7 — STARTTLS in SMTP email settings.** ZTNET v0.7.14 added STARTTLS. Fold into #3 when the
  SMTP email path is built. **[P2]**


## Added by Project Manager:

M2: User account creation is still walled off from a UI/UX thing where you have to create a new organization prior to being able to create accounts. Move the organization tab switch to the bottom of the side taskbar tree and seperate out account management into its own section that is visual to accounts with the proper roles scoped.

M4: design overhaul and fuction overhaul of network members. Take insiration from the link and redesign the network page. Functions available from these screenshots should be added. https://github.com/sinamics/ztnet/blob/main/docs/images/showcase/network_local.jpg, https://github.com/sinamics/ztnet/blob/main/docs/images/showcase/member_options.jpg

M6: Adding a Admin (super-user/owner role) ZT Controller page to show the full status of the controller itself and its settings. Refrence: https://github.com/sinamics/ztnet/blob/main/docs/images/showcase/admin_controller.jpg


---

## Execution order — easiest/quickest → hardest/longest

Ordered across the whole remaining backlog (P-items + M-items + ZTNET ideas). Rough effort
in parens.

1. **I5 — reject/merge duplicate managed routes on save.** (S, harden `networkValidation.ts`).
2. **I6 — expose rate-limit options in an admin settings UI.** (S–M, surface the existing env
   knobs for the login + self-authorize limiters).
3. **M6 — Admin ZT Controller status/settings page.** (M, new super-admin page + expand the
   `/controller/status` endpoint beyond address/online/version).
4. **M2 — sidebar reorg: org switch to bottom + standalone account-management section.** (M,
   UI restructure of `components/Sidebar.tsx` + role-scoped accounts route).
5. **#1 — OIDC/SSO login.** (M, `lib/services/auth.ts` + callback route + provider config).
6. **#3 + I7 — complete email + webhook notifications.** (M–L, SMTP w/ STARTTLS + more events
   + a real background scheduler).
7. **#6 + I1 — presence/metrics depth + real-time push.** (M–L, a background scheduler unblocks
   accurate presence/metrics; a WebSocket/SSE channel makes updates instant — shares the
   scheduler with #3).
8. **I2 — row virtualization + database-first member sync for large networks.** (M–L).
9. **M4 — network members design + function overhaul.** (L, redesign after the ZTNET showcase).
10. **#5 — visual flow-rule builder.** (L, block-based editor emitting rule source + presets).
11. **I3 — internationalization (i18n).** (L, message catalog + locale switch across the UI).
12. **I4 — responsive/mobile member table + PWA.** (L).
13. **#2 — Prisma 5 → 7 major upgrade.** (L / risky, follow the migration guide).
14. **#4 — private root / custom planet (mkworld).** (XL, binary tooling in the image + docs).
