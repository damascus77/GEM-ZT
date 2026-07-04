# Next.js 14 → 15 upgrade (clear CVEs)

## Goal

Eliminate the 9 `next`-related `npm audit` findings (5 high, 3 moderate, plus the
`eslint-config-next`/`glob` chain that audit reports as high via `@next/eslint-plugin-next`)
by upgrading `next` from `^14.2.35` to the latest 15.5.x, with the minimum breaking-change
surface needed to get there safely.

## Decision: target 15.x, not 16.x

Every advisory affecting the installed `next` range is fixed by some 15.5.x release — the
highest "fixed at" version across all findings is **15.5.16**. `npm audit`'s suggested fix
version of `16.2.10` is just npm defaulting to latest-available, not a requirement; jumping to
16 would add a second major version's worth of unknowns (likely a forced React 19 bump,
Turbopack-by-default, other removals) with no additional CVE benefit today. Target the latest
15.5.x release at implementation time.

## Scope

- Bump `next` → latest `15.5.x` and `eslint-config-next` to match.
- Keep React at `18.3.1` (Next 15 supports React 18.2+; no forced React 19 migration).
- Fix the one breaking change this codebase actually hits: **dynamic route `params` (and the
  page-level `searchParams` prop, `cookies()`, `headers()`) become `Promise`-wrapped** in Next
  15, in both Route Handlers and Page components.
- Re-run `npm audit` after the bump to confirm the `next`-related findings are gone.

## Explicitly out of scope

Tracked as separate follow-up items, not blocking this one:

- **Next 16** — no CVE benefit today; larger unknown surface (see decision above).
- **`vitest`/`esbuild` moderate CVE** (`GHSA-67mh-4wv8-2f99`) — dev-server-only exposure
  (requires a malicious site reaching a locally-running `vite dev` server), fix requires a
  `vitest` 4.x major bump touching all 78 test files. Separate TODO item.
- **Prisma 5 → 7** — already tracked separately in `TODO.md`.

## Codebase impact inventory

Confirmed by grep across `app/`, `lib/`, `components/` — this list is exhaustive for this
codebase, not a general Next 15 migration guide:

- No `middleware.ts` — unaffected by middleware/proxy-redirect changes.
- No `next/image` usage — unaffected by Image Optimizer changes.
- No `next/headers` (`cookies()`/`headers()`) usage — session cookies are read manually off
  the raw `Request`/`Headers`, unaffected.
- No relied-upon `fetch()` caching (no `revalidate`/`next: {...}` fetch options anywhere) —
  unaffected by the Next 15 fetch-caching-defaults flip.
- **10 files** use the synchronous `{ params }: { params: { x: string } }` pattern and must
  move to `{ params }: { params: Promise<{ x: string }> }` + `const { x } = await params`:
  - `app/api/v1/apikeys/[id]/route.ts`
  - `app/api/v1/networks/[nwid]/route.ts`
  - `app/api/v1/networks/[nwid]/clone/route.ts`
  - `app/api/v1/networks/[nwid]/members/route.ts`
  - `app/api/v1/networks/[nwid]/members/[memberId]/route.ts`
  - `app/api/v1/networks/[nwid]/presence/route.ts`
  - `app/api/v1/networks/[nwid]/rules/route.ts`
  - `app/api/v1/templates/[id]/route.ts`
  - `app/api/v1/templates/[id]/apply/route.ts`
  - `app/(ui)/networks/[nwid]/page.tsx` and `app/(ui)/networks/[nwid]/join/page.tsx` — Page
    components, same async-params change; both must become `async function` components.
- `app/api/v1/audit/route.ts` uses `new URL(req.url).searchParams` — this is untouched by the
  Next 15 change (it's not the framework's injected `searchParams` prop).

## Verification / rollback

Run the existing `typecheck` + `lint` + full `vitest run` suite (78 tests) after the bump. The
async-params change is compile-time-visible: TypeScript will flag every un-awaited
`params.x`/`context.params.x` access once the type changes to `Promise<...>`, so `tsc --noEmit`
alone should catch any missed call site. Manually smoke-test the two affected pages (network
detail, join page) and a couple of the affected API routes in the dev server.

Rollback is trivial if something is fundamently broken: revert `package.json`/lockfile plus the
~10 touched files — no data migration, no schema change, no Docker image change involved
(unlike the Prisma-major or docker-related backlog items).

## Testing plan

- `npm run typecheck` — must be clean with zero `any`-suppressions added to route/page files.
- `npm run lint` — `eslint-config-next` bump must not introduce new lint errors (or must be
  fixed if it does; no blanket rule-disabling).
- `npm run test` — full existing suite must stay green.
- `npm audit` — confirm all `next`-attributed findings are cleared; document any remaining
  findings (expected: only the pre-known `vitest`/`esbuild` one) as still-open in `TODO.md`.
- Manual smoke test in dev server: load `/networks/[nwid]`, load `/networks/[nwid]/join`,
  exercise one GET and one PATCH/DELETE route with a real `nwid` path param.
