# GEM-ZT — TODO

Working backlog for GEM-ZT. v1 (32 tasks) is merged to `master` and runs in Docker
via `docker compose up -d --build`. Completed items have moved to
[`Completed_TODO.md`](Completed_TODO.md). This file tracks what's left, prioritized.

Legend: **[P0]** blocker / do now · **[P1]** important · **[P2]** nice-to-have · **[P3]** longer-term.

---

## Prioritized backlog

### P1 — high value, do next
1. **Next 14 → 15/16 major upgrade.** Clears the outstanding `next` security advisories
   (npm-audit CVEs not cleared on 14.2.x — App Router breaking changes). Schedule as its own
   task; too large for a one-shot. *(Currently patched to 14.2.35, which fixed 31 patch
   releases but not the advisories needing a major bump.)*
2. **IPv4/IPv6 assign-mode toggles + full per-member controls.** UI for `v4AssignMode.zt`,
   `v6AssignMode` (`zt`/`6plane`/`rfc4193`) in `NetworkSettings`. (Network-level toggles and
   per-member `noAutoAssignIps`/`activeBridge` are already shipped — this is the remaining
   assign-mode piece.)
3. **Multi-user, organizations, and roles.** ZTNET's headline feature and the explicit v1
   deferral (spec §11). `User.role`, the audit log, and API-key model were built to grow into
   this. Large — schedule as its own wave (auth middleware + every service authorization check
   + UI).
4. **OIDC/SSO login.** For self-hosters this means Authelia/Authentik/Keycloak. Reasonable
   alongside (or before) full multi-user, as an alternative admin credential. Medium
   (`lib/services/auth.ts` + callback route).

### P2 — valuable, schedule opportunistically
5. **Prisma 5.22 → 7.x major upgrade.** Optional; follow the migration guide if taken.
   Deferred as large/risky.
6. **Complete email + webhook notifications.** Webhook slice for "new unauthorized member" is
   done (`lib/services/webhooks.ts`). Still open: SMTP email, more events (deauthorized /
   controller degraded), and a real background scheduler — webhooks currently only fire while
   a member list is being viewed.
7. **Pending-queue polish.** QR code and a time-limited self-authorize token for the
   per-network join page (deferred earlier to avoid a QR dependency / extra token table).
8. **Backup/restore edge case.** An existing network with compiled rules but no stored
   `rulesSource` won't re-push rules on restore — low-risk, but worth a guard or warning.

### P3 — longer-term / larger effort
9. **Private root / custom planet (mkworld).** Generate a custom planet so nodes don't depend
   on ZeroTier's public roots — the "fully self-hosted" endgame. Large: binary tooling in the
   image + docs; the controller API gives no help here.
10. **Visual flow-rule builder.** Block-based editor (source/dest/port/action rows) that emits
    rule-language source, alongside the text editor, with a starter-preset library (default
    allow, isolate-clients, expose-one-server). Makes ZeroTier's most powerful capability
    approachable; the vendored compiler gives round-trip validation. Large
    (`components/networks/RulesEditor.tsx`).
11. **Presence history / metrics depth.** Both features are live but sampling is opportunistic
    (only while a page is open) — a real background scheduler would make "offline > N days"
    bulk-select and metrics accurate between page visits.
