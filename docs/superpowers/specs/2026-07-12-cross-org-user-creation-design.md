# GEM-ZT — Cross-Org User Creation — Design

**Status:** Approved (brainstorm) · **Date:** 2026-07-12

## 1. Goal & scope

Today, creating a user requires first navigating to a specific organization's Members
page (`/orgs/{orgId}/members`) and using its "Add member" form, which only assigns the
new user to that one org. There is no single place to create a user, pick their role,
and assign them to *any* organization you manage in one step — you have to already be
looking at the org you want.

**In scope**

- Enhance the existing "Add member" card on the Members page into a **"Create user"**
  card that includes an organization picker, so username + password + role + org
  assignment all happen in one form, regardless of which org's Members page you opened.
- Available to **any org admin/owner**, not just super-admins — each caller's org picker
  is limited to organizations where they hold `admin` or `owner` rank (super-admins see
  every org).
- Role options in the form narrow live based on the caller's rank in the *currently
  selected* org (a caller can be `owner` in one org and `admin` in another).

**Out of scope**

- Invite-link onboarding (`OrgInvitations.tsx`) — unchanged. This design covers only
  direct username/password creation, matching what was asked for.
- Any backend/API changes — see §2, the existing endpoints already do everything needed.
- Changes to who can reach the Members page itself (already solved: any admin/owner/
  super-admin with an active org sees "Members" in the sidebar).

## 2. Why no backend changes are needed

Two existing endpoints already provide exactly what this needs:

- **`GET /api/v1/orgs`** — for a super-admin, returns *every* organization; for anyone
  else, returns only the orgs they belong to, each with their `role` in that org. This is
  already used by `AdminOrgs.tsx` (currently gated to super-admins in the UI, but the
  route itself has no such restriction).
- **`POST /api/v1/orgs/{orgId}/members`** — creates the user *and* the org membership
  (with role) in one call, already enforcing a per-org role cap (`ROLE_RANK[body.role] >=
  ROLE_RANK[auth.role]` fails unless the caller is `owner` or super-admin in **that**
  `orgId`). Since the cap is evaluated from the URL's `orgId`, calling it with a
  different org than the page's own `orgId` already works correctly with zero changes.

This is a frontend-only feature: a smarter form in front of endpoints that already exist.

## 3. UI changes

All changes are in `components/OrgMembers.tsx` (rendered from
`app/(ui)/orgs/[orgId]/members/page.tsx`, unchanged):

- Card heading: **"Add member"** → **"Create user"**.
- New **Organization** field, added before Role:
  - Fetch `GET /api/v1/orgs`, compute `manageableOrgs`: super-admins get the full list;
    everyone else gets only orgs where `role` is `admin` or `owner`.
  - If `manageableOrgs.length === 1`, render a read-only label with that org's name (no
    pointless single-option dropdown).
  - If 2+, render a real `<select>` defaulting to the current page's `orgId`, listing
    every manageable org by name.
- **Role** `<select>` options are filtered to those the caller may grant *in the
  currently selected org* (below the caller's rank there, or unrestricted for owners/
  super-admins) — recomputed on org selection change, not fixed to the page's own org.
- Submit posts to `` `/api/v1/orgs/${selectedOrgId}/members` `` (the *selected* org, which
  may differ from the page's own `orgId`).
- On success:
  - If `selectedOrgId === orgId` (the page's own org), invalidate
    `['org-members', orgId]` as today — the visible table refreshes immediately.
  - If a *different* org was selected, don't touch the currently-displayed table;
    instead show a success message naming the target org, e.g. *"newuser created and
    added to Acme Corp."*
- If `GET /api/v1/orgs` fails to load, degrade to today's behavior: org field disabled,
  showing just the current page's org as the only option.

No other pages, routes, or nav change. The Members page's reachability for any
admin/owner/super-admin (once they have an active org) is already covered by the
existing sidebar work — this design only changes what's inside the Members page's
existing "Add member" card.

## 4. Testing

- Update `tests/ui/org-members.test.tsx` (existing 13 tests) for the new org field
  appearing in the form.
- New cases:
  - Cross-org assignment: select a different manageable org, submit, assert the POST
    target is that org's endpoint and the success message names it (not the page's org).
  - Role narrowing: switching the org selection to one where the caller has a lower
    rank removes the now-disallowed role options from the dropdown.
  - Single-org caller: org field renders as a read-only label, not a `<select>`.
  - `GET /api/v1/orgs` failure: form still renders and works, scoped to the page's own
    org only.

## 5. Build order

Single phase — this is a self-contained, independently-shippable UI change:

1. Add the org-fetch + `manageableOrgs` computation to `OrgMembers.tsx`.
2. Add the Organization field (label or select) and wire role-narrowing to the selected
   org.
3. Change the submit target and success/invalidation logic to key off the selected org.
4. Update/extend `tests/ui/org-members.test.tsx`.
