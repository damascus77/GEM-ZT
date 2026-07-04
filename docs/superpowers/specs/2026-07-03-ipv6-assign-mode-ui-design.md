# IPv4/IPv6 assign-mode UI — close the IPv6-pool gap

## Goal

Make the already-shipped "IPv6 from pools" toggle actually usable by letting operators
create IPv6 pools through the UI, and stop the pool validator from falsely flagging
well-formed IPv6 pools as malformed.

## Already done — no work needed here

Verified by reading the actual components (the TODO item's premise was stale):

- `v4AssignMode.zt` and `v6AssignMode.zt/6plane/rfc4193` checkboxes already exist in
  `components/networks/RoutesEditor.tsx` and PATCH correctly via
  `lib/services/networks.ts`.
- Per-member `activeBridge`/`noAutoAssignIps` toggles already render and save in
  `components/members/MemberTable.tsx`.

## The actual gap

`cidrToPool()` in `lib/util/cidr.ts` only handles IPv4 CIDR input (throws on IPv6), and
"Add pool from CIDR" in `RoutesEditor` is the *only* UI path to create a pool. So there is
currently no way to create an IPv6 pool at all — meaning the "IPv6 from pools" checkbox has
nothing to actually assign from. Separately, `validateRoutesAndPools()` in
`lib/util/networkValidation.ts` runs every pool through IPv4-only parsing and would flag any
IPv6 pool as having a "malformed address," even though the backend
(`z.string().ip()` in `lib/services/networks.ts`) already accepts IPv6 addresses fine.

## Scope

1. **`lib/util/cidr.ts` — extend `cidrToPool()` to IPv6.**
   Detect address family (reuse the existing `isValidCidr`/`isIpv6` structural checks), and
   for IPv6 compute the first/last address of the CIDR block using `BigInt` (128-bit)
   arithmetic — the same shape as the existing IPv4 uint32 approach, just wider. Returns the
   same `{ ipRangeStart, ipRangeEnd }` shape, so no caller-side branching is needed.

2. **`components/networks/RoutesEditor.tsx` — no new UI, just unblock the existing one.**
   The "Add pool from CIDR" input already accepts free text; once `cidrToPool` handles IPv6,
   typing e.g. `fd00::/112` there just works. Update the input's placeholder to hint both
   families are supported (e.g. `10.10.0.0/16 or fd00::/112`).

3. **`lib/util/networkValidation.ts` — fix the false positive; stay IPv4-only for math.**
   In the pools-validation loop, check `looksLikeIpv6(p.ipRangeStart)` (the helper already
   used for DNS servers) first — if both start/end look like IPv6, skip the IPv4
   malformed/containment checks for that pool entirely (format-only, matching the file's
   existing documented behavior for IPv6 route targets). Only report "malformed address" if
   a pool address is neither valid IPv4 nor plausible IPv6.

## Explicitly out of scope

- 128-bit overlap/containment/gateway-inside-route math for IPv6. Stays IPv4-only, as
  already documented in `networkValidation.ts`'s file-level comment. This change is scoped
  to "make v6-from-pools usable," not a general IPv6 validation overhaul.
- Any backend/schema change — `z.string().ip()` already accepts IPv6 addresses; no server
  work needed.

## Testing plan

- Unit tests for `cidrToPool` with IPv6 inputs: a typical `/112` pool range, edge cases at
  `/127` and `/128`, and a regression check that IPv4 behavior is unchanged.
- Unit tests for `validateRoutesAndPools` confirming an IPv6 pool no longer produces a
  "malformed address" warning, while a genuinely malformed pool (neither valid IPv4 nor
  plausible IPv6) still does.
- Manual smoke test in the dev server: enable "IPv6 from pools," add a pool via
  `fd00::/112`, save, confirm no warning and the PATCH succeeds against a real/dev
  controller.
