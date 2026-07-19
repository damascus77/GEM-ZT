# Fast, seamless loading for the Status page + other slow surfaces

## Context

The networks **members** page was recently reworked to load fast and feel seamless. That win came from a two-part pattern, not a single trick:

- **Server:** expensive controller fan-outs are wrapped in `coalesce(key, ttl, fn)` (`lib/util/cache.ts`) so overlapping polls/tabs share one sweep; the peer sweep and member roster are cached under shared keys and busted on write.
- **Client:** TanStack Query with `placeholderData: keepPreviousData` (polls never blank the screen) and **skeletons** instead of a bare `Loading…` on first load.

The user wants the same feel on the **status page** and the other genuinely-slow surfaces. Scope (confirmed): **Status + Networks list + Pending members**, with **real server-side caching** (reuse existing sweeps), not just cosmetic skeletons.

The status page is the biggest offender: `StatusDashboard` (`components/StatusDashboard.tsx`) shows a bare `Loading…`, polls `/api/v1/metrics` every 10s, and its backing `collectMetrics()` (`lib/services/metrics.ts`) does its **own uncached, doubly-nested N+1** (`getMember` for every member of every network) on every request — duplicating work the members page already caches.

## Goal

Make Status and Networks paint instantly and stay populated across polls, and make their backing controller reads share the already-coalesced caches — so nothing re-fans-out redundantly and no surface hangs on a bare "Loading…".

---

## Changes

### 1. Status page — server (the real latency fix)

**`lib/services/metrics.ts` — `collectMetrics()`**

- Replace the private double N+1 (lines 78–92: `mapWithConcurrency(ids, ...)` → `listMemberIds` → `mapWithConcurrency(memberIds, getMember)`) with reuse of the **already-coalesced** `listMembers(nwid)` from `lib/services/members.ts`.
  - `listMembers` returns `MemberView[]` with `authorized` and `online` already computed. `online` there is `peer.paths.some(p => p.active)` — the **same semantics** as the current `onlineAddrs` logic, so counts are behavior-preserving.
  - New shape: `ids = client.listNetworkIds()`; for each `nwid`, `const members = await listMembers(nwid)`; count `members.length`, `authorized`, and `online`. This drops the separate `listPeers()` call in metrics because `listMembers` already folds in the (coalesced) peer sweep via `loadContext`.
  - Keep the existing `ControllerUnreachableError` → zeroed-snapshot fallback (lines 100–111).
- Wrap the whole snapshot in `coalesce('metrics', getControllerCacheTtlMs(), collectMetricsUncached)` (import `coalesce` from `@/lib/util/cache`, `getControllerCacheTtlMs` from `@/lib/controller`). With the 10s client poll and a ~3s TTL, cross-tab polls collapse and the sweep is shared with the members page.

Net effect: the status page piggybacks on the same cached member/peer data the members page already fetches, instead of doing its own full sweep every 10s.

### 2. Status page — client (instant paint + no-blank polls)

**`components/StatusDashboard.tsx`**

- Add `placeholderData: keepPreviousData` (import from `@tanstack/react-query`) to the `['metrics']` query so the 10s refetch never drops back to the loading state.
- Replace `if (isLoading) return <p>Loading…</p>` (line 30) with **skeleton stat cards** shown only on true first load (`isLoading && !data`), using `Skeleton` from `components/ui/Skeleton` inside the existing `StatCard` layout so the grid doesn't jump. Keep the existing error branch.
- **Split fast core from slow enrichment** (mirrors the members roster-vs-presence split): render the "Controller Reachable/Unreachable" card from the lightweight `useControllerStatus()` hook (`components/DegradedBanner.tsx`, already polling `/api/v1/controller/status` app-wide every 5s and typically warm) so the reachability card appears **immediately**, while the 4 heavy stat cards fill in from `['metrics']` with skeletons. `StatCard` already tolerates `value === undefined` (renders `—`), so no signature change needed.

### 3. Networks list — server

**`lib/services/networks.ts` — `listNetworksForOrg()`** (lines 153–183)

- Wrap the per-network `getNetwork` + `listMemberIds` fan-out in `coalesce(networksCacheKey(orgId), getControllerCacheTtlMs(), ...)` to collapse the 5s poll across tabs.
- Add cache-key helpers and a `bustNetworkListCaches()` that invalidates the network-list keys, called from every network write in this file: `createNetwork`, `createNetworkFromConfig`, `cloneNetwork`, `updateNetwork`, `deleteNetwork`. Because list keys are org-scoped, track live network-list keys in a module-level `Set<string>` (registered inside `coalesce`'s wrapper) and bust all of them on write — mirroring the "bust on write" discipline `bustMemberCaches` uses in `members.ts`. (Also apply to `listNetworks`/`listUnassignedNetworks` for consistency if trivial.)

### 4. Networks list — client

**`components/networks/NetworkList.tsx`**

- Add `placeholderData: keepPreviousData` to the `['networks']` query (line 36).
- Replace the bare `{isLoading && <p>Loading…</p>}` (line 136) with a grid of **skeleton cards** on first load (`isLoading && !data`), matching the existing `Card` grid so layout is stable.

### 5. Pending members — already done (verify only)

`components/PendingMembers.tsx` already uses `SkeletonRows` + `placeholderData: keepPreviousData`, and its server path (`collectPending` → `listMembers(nwid)` per network) already rides the coalesced member cache. **No code change** — just confirm during verification that it still behaves. Noted here so scope is explicit.

---

## Reused building blocks (do not reinvent)

- `coalesce(key, ttlMs, fn)` / `bustCache(key)` — `lib/util/cache.ts`
- `getControllerCacheTtlMs()` — `lib/controller/index.ts`
- `listMembers(nwid)` (coalesced roster incl. `authorized`/`online`) — `lib/services/members.ts`
- `Skeleton` / `SkeletonRows` — `components/ui/Skeleton.tsx`
- `useControllerStatus()` — `components/DegradedBanner.tsx`
- `keepPreviousData` + global `staleTime: 5000` defaults — `app/providers.tsx`

## Files to modify

- `lib/services/metrics.ts` (server: reuse `listMembers` + coalesce)
- `components/StatusDashboard.tsx` (client: skeletons, keepPreviousData, split reachability)
- `lib/services/networks.ts` (server: coalesce list + bust on write)
- `components/networks/NetworkList.tsx` (client: skeletons, keepPreviousData)

## Tests

- **`lib/services/metrics.ts`**: add/adjust a unit test asserting `collectMetrics()` counts networks/members/authorized/online correctly from mocked `listMembers`, returns the zeroed snapshot on `ControllerUnreachableError`, and that a second call within the TTL does **not** re-invoke the underlying fan-out (coalescing). Follow existing member/cache test patterns under `tests/`.
- **`lib/services/networks.ts`**: test that `listNetworksForOrg` coalesces within the TTL and that a write busts the list cache (next read re-fetches).
- Keep existing status/networks UI tests green; extend if there's an existing `StatusDashboard`/`NetworkList` test to assert skeletons render on first load and data persists across a simulated refetch.
- Run the full suite: `npm test` (and `npx tsc --noEmit` / lint if configured).

## Verification (end-to-end)

1. Start the dev server via the Browser pane (`preview_start` with the dev config from `.claude/launch.json`, or create one running `npm run dev`).
2. **/status**: on first load, confirm skeleton stat cards (not bare "Loading…") and that the Controller card appears immediately; then real counts fill in. Watch it through a 10s poll — the cards must not blank. Check `read_network_requests` to confirm `/api/v1/metrics` is served fast and check `read_console_messages` for errors.
3. Open **/networks** in another tab alongside a network's **members** tab; confirm the metrics/members/peer sweeps are shared (no redundant burst of controller calls) and both stay populated across polls.
4. **/networks**: confirm skeleton cards on first load and no blank on the 5s poll; create a network and confirm the list updates promptly (cache busted on write).
5. **/pending**: confirm unchanged (skeletons + no blank).
6. Screenshot /status and /networks first-load states as proof.
