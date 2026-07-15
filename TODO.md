# GEM-ZT — TODO

Working backlog for GEM-ZT. v1 (32 tasks) is merged to `master` and runs in Docker
via `docker compose up -d --build`. Completed items have moved to
[`Completed_TODO.md`](Completed_TODO.md). This file tracks what's left, prioritized.

Legend: **[P0]** blocker / do now · **[P1]** important · **[P2]** nice-to-have · **[P3]** longer-term.

---

## Prioritized backlog

### P1 — high value, do next

1. **Multi-user, organizations, and roles.** ZTNET's headline feature and the explicit v1
   deferral (spec §11). `User.role`, the audit log, and API-key model were built to grow into
   this. Large — schedule as its own wave (auth middleware + every service authorization check
   - UI).
2. **OIDC/SSO login.** For self-hosters this means Authelia/Authentik/Keycloak. Reasonable
   alongside (or before) full multi-user, as an alternative admin credential. Medium
   (`lib/services/auth.ts` + callback route).

### P2 — valuable, schedule opportunistically

3. **Prisma 5.22 → 7.x major upgrade.** Optional; follow the migration guide if taken.
   Deferred as large/risky.
4. **Complete email + webhook notifications.** Webhook slice for "new unauthorized member" is
   done (`lib/services/webhooks.ts`). Still open: SMTP email, more events (deauthorized /
   controller degraded), and a real background scheduler — webhooks currently only fire while
   a member list is being viewed.
5. **Pending-queue polish.** QR code and a time-limited self-authorize token for the
   per-network join page (deferred earlier to avoid a QR dependency / extra token table).
6. **Backup/restore edge case.** An existing network with compiled rules but no stored
   `rulesSource` won't re-push rules on restore — low-risk, but worth a guard or warning.

### P3 — longer-term / larger effort

7. **Private root / custom planet (mkworld).** Generate a custom planet so nodes don't depend
   on ZeroTier's public roots — the "fully self-hosted" endgame. Large: binary tooling in the
   image + docs; the controller API gives no help here.
8. **Visual flow-rule builder.** Block-based editor (source/dest/port/action rows) that emits
   rule-language source, alongside the text editor, with a starter-preset library (default
   allow, isolate-clients, expose-one-server). Makes ZeroTier's most powerful capability
   approachable; the vendored compiler gives round-trip validation. Large
   (`components/networks/RulesEditor.tsx`).
9. **Presence history / metrics depth.** Both features are live but sampling is opportunistic
   (only while a page is open) — a real background scheduler would make "offline > N days"
   bulk-select and metrics accurate between page visits.



## Added by Project Manager:

M1: Increase usability of member sections in the network. Currently there are long load times when adding members or refreshing the page to get updated status. I want the online or offline times to be nearly immediate and for all values to be able to live changes without refreshing the page.

M2: User account creation is still walled off from a UI/UX thing where you have to create a new organization prior to being able to create accounts. Move the organization tab switch to the bottom of the side taskbar tree and seperate out account management into its own section that is visual to accounts with the proper roles scoped.

M3: When filling in fields in the members and routes & ip section of a selected network I want it to be clear once a valid field has been typed and for it to bouble as a selected field within the box

M4: design overhaul and fuction overhaul of network members. Take insiration from the link and redesign the network page. Functions available from these screenshots should be added. https://github.com/sinamics/ztnet/blob/main/docs/images/showcase/network_local.jpg, https://github.com/sinamics/ztnet/blob/main/docs/images/showcase/member_options.jpg

M4: Current boxes take up too much vertical space. I would prefer to not have to scroll down to access settings or info that is frequently needed. Flow rules and DNS can stay at the bottom and require a scroll because they are not used as often but members and routes and IP pools should be easily accessed.

M5: Adding a Admin (super-user/owner role) ZT Controller page to show the full status of the controller itself and its settings. Refrence: https://github.com/sinamics/ztnet/blob/main/docs/images/showcase/admin_controller.jpg

M6: Read through ZTNETs github release list of previous version release note to generate ideas to add to the TODO.md. Refrence: https://github.com/sinamics/ztnet/releases#release-v0.8.2

