# Audit top-priority fixes (P0)

## Context

The 2026-07-19 audits (recorded in [`TODO.md`](../../../TODO.md#audit-findings-2026-07-19))
flagged five P0 items — one UI contrast bug and four reliability defects. None are security
CRITICALs and none block the build (741/748 tests pass; the 7th failure is the environmental
`GEMZT_SETUP_TOKEN` test-isolation gap, AUD-16, tracked separately). These five are grouped
here because they are the highest-impact, are individually small, and touch mostly independent
files — so they can land as one focused branch with a shared test pass.

- **AUD-01 [UI]** — status pills & diff text invisible in the default dark theme.
- **AUD-02 [REL]** — `createOrg` not atomic → ownerless org on partial failure.
- **AUD-03 [REL]** — last-owner guard TOCTOU → org can reach zero owners.
- **AUD-04 [REL]** — unbounded controller fan-out in the three network-list paths.
- **AUD-05 [REL]** — backup restore non-idempotent + aborts mid-run on any non-404 error.

## Goal

Make the core status signals readable in both themes, and close the four
correctness-under-failure gaps so multi-step writes are atomic, the controller isn't flooded
on list loads, and a restore degrades gracefully instead of leaving partial state. All changes
are behavior-preserving on the happy path; only failure/edge behavior changes.

---

## Changes

### AUD-01 — Legible status pills + diff lines in both themes

**Root cause.** The brand color `teal-deep` (#0e3030) is a single value shared across themes
(`lib/design/tokens.ts:18`). Sites set `text-teal-deep` as _foreground_ text — on the dark
theme's `canvas` (#1c1a2e) / `canvas-soft` (#100e1c) that's ≈1.1:1, invisible. `AcceptedChip`
already solved the pill case with a **filled** `bg-teal-mid text-white`
(`components/ui/AcceptedChip.tsx:14-18`); the diff-text case needs a theme-aware foreground
token because a single fixed value can't be legible on both a near-white and a near-black
background.

1. **Add theme-aware semantic tokens** (source of truth first). In `lib/design/tokens.ts` add to
   `semanticColorsLight` / `semanticColorsDark`:
   - `success` (positive foreground text — legible on that theme's canvas): light `#0e3030`
     (current teal-deep, fine on white), dark `#5fd0c4` (light teal, legible on #100e1c).
   - `success-surface` / `on-success` for the filled pill if we want it theme-aware; the
     proven `bg-teal-mid text-white` already works in both themes, so reuse that and skip new
     surface tokens unless verification shows otherwise.
   - Mirror the CSS variables in `app/globals.css` (`--c-success` under `:root` and `.dark`,
     following the existing `--c-ink` pattern at lines 9-22) and register `success` in
     `tailwind.config.ts` so `text-success` compiles.
   - This same token pass sets up the **`danger`** token needed for AUD-12 (P1) — add
     `danger`/`danger-surface` alongside `success` now so the design-system edit is done once,
     even though the destructive-button work is deferred.

2. **Add a `tone` prop to the `Pill` primitive** (`components/ui/Pill.tsx`). Default keeps the
   current `border-hairline bg-canvas text-ink`; `tone="success"` renders the AcceptedChip
   style (`border-teal-mid bg-teal-mid text-white`). Keep it a small string-literal union
   (`'default' | 'success'`), extendable to `'danger'` later.

3. **Replace the invisible pill sites** with `<Pill tone="success">`:
   - `components/members/MemberTable.tsx:85` (Online) and `:95` (Direct)
   - `components/PendingMembers.tsx:24` (Online)
   - `components/StatusDashboard.tsx:51` (Reachable) — only when reachable; keep the existing
     styling for the unreachable state.
   - Remove the now-dead `border-teal-mid text-teal-deep` className from each.

4. **Fix the diff "added" lines** (foreground text, not pills) to use `text-success`:
   - `components/networks/RulesEditor.tsx:177`
   - `app/(ui)/audit/page.tsx:39`
     (Leave the removed/`text-red-*` side alone; confirm the red side is also legible in dark
     during verification — if not, fold a `danger` foreground token in from step 1.)

5. **De-dup follow-up (optional, same PR if cheap):** `PresencePill` is defined twice
   (`MemberTable.tsx:84`, `PendingMembers.tsx:23`). Once both use `<Pill tone="success">` they're
   identical — extract a shared `StatusPill`/`PresencePill` into `components/ui/` (this is
   AUD-29, promoted opportunistically).

### AUD-02 — Make `createOrg` atomic

`lib/services/orgs.ts:38-50`. Wrap the org insert + owner-membership insert in one interactive
transaction so a failure can't commit an ownerless org. `uniqueSlug` stays outside the
transaction (it's a read-only pre-check; a rare slug race still surfaces as a unique-constraint
error, which is acceptable and already possible).

```ts
export async function createOrg(input: {
  name: string;
  createdById: string;
}): Promise<Organization> {
  const slug = await uniqueSlug(slugify(input.name));
  return getDb().$transaction(async tx => {
    const org = await tx.organization.create({
      data: { name: input.name, slug, createdById: input.createdById },
    });
    await tx.membership.create({
      data: { orgId: org.id, userId: input.createdById, role: 'owner' },
    });
    return org;
  });
}
```

SQLite with `connection_limit=1` (`lib/db/client.ts`) handles interactive transactions fine —
`deleteOrg`/`removeMember` already use `$transaction` in this same file.

### AUD-03 — Close the last-owner TOCTOU

`lib/services/orgs.ts:98-120`. Move the `ownerCount` check **inside** the write transaction in
both `setMemberRole` and `removeMember`, so the count and the mutation are one atomic unit and
two concurrent demotions can't both pass the guard.

```ts
export async function setMemberRole(orgId: string, userId: string, role: OrgRole): Promise<void> {
  await getDb().$transaction(async tx => {
    const current = await tx.membership.findUnique({ where: { userId_orgId: { userId, orgId } } });
    if (current?.role === 'owner' && role !== 'owner') {
      const owners = await tx.membership.count({ where: { orgId, role: 'owner' } });
      if (owners <= 1) throw new LastOwnerError();
    }
    await tx.membership.update({ where: { userId_orgId: { userId, orgId } }, data: { role } });
  });
}
```

`removeMember` gets the same treatment, folding its existing two-statement `$transaction`
(membership delete + api-key delete) and the owner-count guard into one interactive
transaction. `LastOwnerError` thrown inside the callback rolls the transaction back and
propagates unchanged, so the route's error mapping is unaffected. Note `getMembership` is no
longer called separately in these paths — verify no other caller depended on that side effect
(it doesn't; it's a pure read).

### AUD-04 — Cap controller fan-out in the network-list paths

`lib/services/networks.ts` — `listNetworksUncached` (:165-181), `listNetworksForOrgUncached`
(:203-221), `listUnassignedNetworksUncached` (:257-273). Each does an uncapped
`Promise.all(ids.map(async nwid => { getNetwork + listMemberIds }))`. Replace each with
`mapWithConcurrency(targetIds, 8, async nwid => …)`, matching the cap used in `members.ts`,
`metrics.ts`, and `backup.ts`.

- Add `import { mapWithConcurrency } from '@/lib/util/concurrency';` (not currently imported).
- `listNetworksUncached`: map over `ids`.
- `listNetworksForOrgUncached`: map over `ids.filter(nwid => owned.has(nwid))` (compute the
  filtered array first, then pass to `mapWithConcurrency`).
- `listUnassignedNetworksUncached`: map over `orphanIds`.
- Output order is preserved by `mapWithConcurrency`, and the inner
  `Promise.all([getNetwork, listMemberIds])` (2 calls per network) stays — so peak concurrency
  becomes 8 networks × 2 = 16 controller calls instead of 2N. Behavior-preserving; only
  concurrency changes. These already sit behind `coalesce(...)`, so this bounds the _first_
  (cache-filling) sweep.

### AUD-05 — Backup restore: degrade gracefully + be honest about non-idempotency

`lib/services/backup.ts:200-284`. Two problems: (a) a non-404 controller error at `:278`
(`throw e`) aborts the whole restore mid-way, leaving everything applied so far and losing the
summary; (b) matching by controller-assigned nwid means a network whose nwid is gone gets
_re-minted_ as a new network, so re-running duplicates networks.

1. **Continue-on-error per network.** Wrap the body of the `for (const net of data.networks)`
   loop in try/catch. On error, push a warning
   (`network ${net.nwid}: restore failed — ${message}; skipped`) and `continue` to the next
   network instead of aborting. This mirrors the existing per-member 404 handling
   (`:271-277`).
2. **Continue-on-error per member (non-404 too).** At `:278`, replace `throw e` with a warning
   push + `continue`, so one bad member doesn't abort the rest of the network. Keep the
   distinct 404 "not joined yet" message.
3. **Surface re-mint explicitly.** In the `else` branch (`:244`, `existing` is null → new
   network minted), push a warning:
   `network ${net.nwid} no longer on controller — created a NEW network ${created.data.nwid}
instead of restoring in place; re-running this backup will create duplicates`. This makes the
   non-idempotency visible in `RestoreSummary.warnings` (already rendered by
   `components/BackupControls.tsx`) rather than silent.
4. **Docs.** Update the function's doc comment (`:194-198`) to state restore is _not idempotent_
   once nwids change, and that partial failures are now reported as warnings rather than
   aborting. (A full transactional restore is out of scope — it spans many controller HTTP
   calls that can't join a DB transaction; continue-on-error + honest reporting is the right
   fit for the single-admin model.)

---

## Reused building blocks (do not reinvent)

- `mapWithConcurrency(items, limit, fn)` — `lib/util/concurrency.ts` (order-preserving, cap 8).
- `getDb().$transaction(async tx => …)` — interactive transactions, already used in
  `lib/services/orgs.ts` and elsewhere.
- `AcceptedChip`'s proven `bg-teal-mid text-white` legibility fix — `components/ui/AcceptedChip.tsx`.
- Semantic-token pattern (light/dark CSS vars + tailwind) — `lib/design/tokens.ts`,
  `app/globals.css`, `tailwind.config.ts`.
- `RestoreSummary.warnings` channel + its UI — `lib/services/backup.ts`, `components/BackupControls.tsx`.

## Files to modify

- `lib/design/tokens.ts`, `app/globals.css`, `tailwind.config.ts` — add `success` (+ `danger`) tokens.
- `components/ui/Pill.tsx` — `tone` prop.
- `components/members/MemberTable.tsx`, `components/PendingMembers.tsx`,
  `components/StatusDashboard.tsx` — use `tone="success"`.
- `components/networks/RulesEditor.tsx`, `app/(ui)/audit/page.tsx` — `text-success` diff lines.
- `lib/services/orgs.ts` — atomic `createOrg`, `setMemberRole`, `removeMember`.
- `lib/services/networks.ts` — `mapWithConcurrency` in the three list paths.
- `lib/services/backup.ts` — continue-on-error + re-mint warning + doc.
- (Optional) `components/ui/StatusPill.tsx` — extracted shared pill (AUD-29).

## Tests

Follow existing patterns under `tests/`. Write the failing test first for each behavioral fix.

- **orgs (AUD-02/03):** unit tests in `tests/` mocking `getDb()` —
  (a) `createOrg` rolls back the org when the membership insert throws (org must not exist
  after); (b) `setMemberRole`/`removeMember` throw `LastOwnerError` when demoting/removing the
  sole owner, and succeed with ≥2 owners. A true concurrency race is hard to unit-test against
  SQLite; assert instead that count+write occur inside one `$transaction` callback (spy on the
  tx client), which is the structural guarantee.
- **networks (AUD-04):** assert `listNetworks*` still return the same shape/order, and that with
  N>8 ids the controller client sees at most 8 concurrent `getNetwork` calls (instrument the
  mock with an in-flight counter). Existing networks-routes tests must stay green.
- **backup (AUD-05):** extend `tests/integration/backup-restore-route.test.ts` /
  service tests — a member update that throws a non-404 pushes a warning and the loop continues
  (remaining members still restored); a network-level failure is isolated to that network; a
  re-minted network (existing=null) adds the duplicate-warning. Assert `RestoreSummary` totals.
- **UI (AUD-01):** if a `Pill`/`StatusDashboard`/`MemberTable` render test exists, assert the
  online/reachable pill carries the `tone="success"` classes; contrast itself is verified
  visually below.
- Full gate: `npm run test`, `npm run typecheck`, `npm run lint`.

## Verification (end-to-end)

1. `npm run typecheck && npm run lint && npm run test` — all green (the AUD-16 setup-token
   failure is out of scope; note it if still red).
2. Start the dev server via the Browser pane (`preview_start`, `.claude/launch.json`), in **dark
   theme** (the default):
   - **/networks/[nwid]** members table — the "Online"/"Direct" pills are clearly readable.
   - **/status** — the "Reachable" pill is readable; screenshot as before/after proof.
   - **/pending** — Online pill readable.
   - **/networks/[nwid]** rules editor diff and **/audit** diff — "added" lines are legible
     green; confirm the removed/red lines are also legible.
   - Toggle to **light theme** and re-check all of the above (the token must work both ways).
   - `read_console_messages` clean.
3. **AUD-04**: with several networks, load **/networks** and confirm via `read_network_requests`
   (or controller logs) that controller calls are batched, not a single 2N burst.
4. **AUD-02/03/05** are covered by the automated tests above (server-side, not visible in the
   browser) — rely on the test evidence, don't claim green without it.
5. Screenshot dark-theme /status and the members table (before/after) as the headline proof.

## Sequencing & risk

- **AUD-01** (UI/design-system) and **AUD-02/03/04/05** (server) are independent — safe to do in
  any order or split across commits. Suggested order: tokens+Pill (AUD-01) → orgs (AUD-02/03) →
  networks (AUD-04) → backup (AUD-05), each with its tests.
- Lowest risk: AUD-04 (pure concurrency cap, behavior-preserving) and AUD-01 (styling).
- Highest care: AUD-02/03 (transaction semantics — make sure thrown domain errors still
  propagate to route error mapping) and AUD-05 (error-flow change — ensure no error is now
  silently swallowed beyond the intended continue-on-error, each carries a warning).
- All changes are backward-compatible with the existing API surface and DB schema — no
  migration required.
