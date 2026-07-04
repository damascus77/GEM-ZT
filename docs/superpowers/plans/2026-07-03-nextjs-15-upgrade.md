# Next.js 14 → 15 Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `next` from `^14.2.35` to the latest `15.5.x`, clearing every `next`-attributed `npm audit` finding, by fixing the one breaking change this codebase hits: dynamic route `params` become `Promise`-wrapped in both Route Handlers and Page components.

**Architecture:** No architectural change. This is a dependency bump plus a mechanical signature change across exactly 10 files (8 API route handlers + 2 page components), each converting `{ params }: { params: { x: string } }` to `{ params }: { params: Promise<{ x: string }> }` and adding `const { x } = await params;` (or `await`-ing inline) before first use.

**Tech Stack:** Next.js (App Router), TypeScript, Vitest, Zod. No new dependencies.

## Global Constraints

- Target `next@^15.5.16` or later 15.x (not 16.x) — see spec decision: every CVE affecting the installed range is fixed by some 15.5.x release; 16.x adds unrelated risk with no CVE benefit.
- Keep `react`/`react-dom` at `18.3.1` — Next 15 supports React 18.2+, no forced major bump.
- Do not touch `middleware.ts` (none exists), `next/image` (unused), or `next/headers` (unused) — confirmed out of scope by the spec's codebase inventory.
- No blanket lint-rule disabling to silence new `eslint-config-next` findings — fix any real issue instead.
- Full reference: `docs/superpowers/specs/2026-07-03-nextjs-15-upgrade-design.md`

---

### Task 1: Bump `next` and `eslint-config-next`

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: nothing consumed by later tasks directly — this task only changes the installed dependency version. Later tasks assume `next@15.x` is installed and its route/page typing behavior (async `params`) is in effect at runtime.

- [ ] **Step 1: Check the current installed version and latest available 15.x**

Run: `npm view next versions --json | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const v=JSON.parse(d).filter(x=>x.startsWith('15.'));console.log(v[v.length-1])})"`
Expected: prints the latest published `15.x.y` version string (e.g. `15.5.16` or newer — use whatever this command prints, not a hardcoded number, since patch releases ship frequently).

- [ ] **Step 2: Update `package.json`**

Edit the `dependencies` block in `package.json`:

```json
    "next": "^15.5.16",
```

(Replace `15.5.16` with whatever version Step 1 printed if it's newer.)

Edit the `devDependencies` block in `package.json`:

```json
    "eslint-config-next": "^15.5.16",
```

(Same version as `next`, matching Next's own convention of keeping these in lockstep.)

- [ ] **Step 3: Install**

Run: `npm install`
Expected: exits 0, `package-lock.json` is updated, no `ERESOLVE` peer-dependency errors (Next 15 accepts React 18.2+, so `react@18.3.1`/`react-dom@18.3.1` should resolve cleanly).

- [ ] **Step 4: Confirm the version landed**

Run: `npm ls next`
Expected: shows `next@15.x.y` (the version from Step 1), not `14.x`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: bump next 14 -> 15 to clear CVEs (params/page fixes follow)"
```

---

### Task 2: Fix `apikeys/[id]/route.ts`

**Files:**
- Modify: `app/api/v1/apikeys/[id]/route.ts`
- Test: `tests/integration/apikeys-routes.test.ts`

**Interfaces:**
- Consumes: `deleteApiKey(id: string, userId: string)` from `@/lib/services/apiKeys` (unchanged).
- Produces: nothing new consumed elsewhere — this route has no other callers in the codebase besides its own test file.

- [ ] **Step 1: Update the test call sites to pass `Promise`-wrapped params**

In `tests/integration/apikeys-routes.test.ts`, the two call sites (currently identical) read:

```typescript
    const ok = await keyDelete(req(`http://x/api/v1/apikeys/${apiKey.id}`, 'DELETE'), {
      params: { id: apiKey.id },
    });
    expect(ok.status).toBe(204);
    const gone = await keyDelete(req(`http://x/api/v1/apikeys/${apiKey.id}`, 'DELETE'), {
      params: { id: apiKey.id },
    });
```

Change both `params: { id: apiKey.id }` to `params: Promise.resolve({ id: apiKey.id })`:

```typescript
    const ok = await keyDelete(req(`http://x/api/v1/apikeys/${apiKey.id}`, 'DELETE'), {
      params: Promise.resolve({ id: apiKey.id }),
    });
    expect(ok.status).toBe(204);
    const gone = await keyDelete(req(`http://x/api/v1/apikeys/${apiKey.id}`, 'DELETE'), {
      params: Promise.resolve({ id: apiKey.id }),
    });
```

- [ ] **Step 2: Run the test to see it fail on the type mismatch**

Run: `npx vitest run tests/integration/apikeys-routes.test.ts`
Expected: FAILS to type-check via vitest's esbuild transform is unlikely to catch this (esbuild strips types), so this specific run may actually still PASS at runtime (since `await` on a plain object also resolves — see Step 4 note). Instead, verify the type mismatch directly:

Run: `npx tsc --noEmit`
Expected: FAILS with an error in `app/api/v1/apikeys/[id]/route.ts` similar to `Type '{ id: string; }' is not assignable to type 'Promise<{ id: string; }>'` — because the test file now passes a `Promise`, but the route file's `Ctx` type still declares a plain object.

- [ ] **Step 3: Rewrite the route file to accept and await `params`**

Replace the full contents of `app/api/v1/apikeys/[id]/route.ts`:

```typescript
import { requireAuth } from '@/lib/api/auth';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import { deleteApiKey } from '@/lib/services/apiKeys';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const { id } = await params;
    const deleted = await deleteApiKey(id, auth.user.id);
    if (!deleted) return apiError('NOT_FOUND', `API key ${id} not found.`, 404);
    await logAudit({
      userId: auth.user.id,
      action: 'apikey.delete',
      targetType: 'apikey',
      targetId: id,
    });
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleRouteError(e);
  }
}
```

- [ ] **Step 4: Run typecheck and the test to confirm both pass**

Run: `npx tsc --noEmit && npx vitest run tests/integration/apikeys-routes.test.ts`
Expected: both PASS. (Note: the test would have passed even before this file change, because `await` on a plain object resolves to that object immediately — the real bug this task fixes only manifests against Next's actual production dispatcher, which now passes a real `Promise`. `tsc --noEmit` is the signal that actually catches the mismatch here.)

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/apikeys/\[id\]/route.ts tests/integration/apikeys-routes.test.ts
git commit -m "fix: await Promise-wrapped params in apikeys DELETE route (Next 15)"
```

---

### Task 3: Fix `templates/[id]/route.ts` and `templates/[id]/apply/route.ts`

**Files:**
- Modify: `app/api/v1/templates/[id]/route.ts`
- Modify: `app/api/v1/templates/[id]/apply/route.ts`

**Interfaces:**
- Consumes: `deleteTemplate(id: string)` and `createNetworkFromTemplate(id: string)` from `@/lib/services/templates` (unchanged).
- Produces: nothing new — neither route has a dedicated integration test that calls the handler directly (coverage for template behavior lives in `tests/unit/templates-service.test.ts` and `tests/ui/network-templates.test.tsx`, which don't touch this file's `params` signature). Typecheck is the verification for this task.

- [ ] **Step 1: Rewrite `app/api/v1/templates/[id]/route.ts`**

Replace its full contents:

```typescript
import { requireAuth } from '@/lib/api/auth';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import { deleteTemplate } from '@/lib/services/templates';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const { id } = await params;
    const ok = await deleteTemplate(id);
    if (!ok) return apiError('NOT_FOUND', `Template ${id} not found.`, 404);
    await logAudit({
      userId: auth.user.id,
      action: 'template.delete',
      targetType: 'template',
      targetId: id,
    });
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleRouteError(e);
  }
}
```

- [ ] **Step 2: Rewrite `app/api/v1/templates/[id]/apply/route.ts`**

Replace its full contents:

```typescript
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api/auth';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import { createNetworkFromTemplate } from '@/lib/services/templates';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const { id } = await params;
    const result = await createNetworkFromTemplate(id);
    if (!result) return apiError('NOT_FOUND', `Template ${id} not found.`, 404);
    await logAudit({
      userId: auth.user.id,
      action: 'template.apply',
      targetType: 'network',
      targetId: result.data.nwid,
      detail: { template: id },
    });
    return NextResponse.json({ network: result.data, metaWarning: result.metaWarning }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}
```

- [ ] **Step 3: Run typecheck and the existing template-related test suites**

Run: `npx tsc --noEmit && npx vitest run tests/unit/templates-service.test.ts tests/ui/network-templates.test.tsx`
Expected: both PASS with no changes needed to either test file (neither imports these route handlers directly).

- [ ] **Step 4: Commit**

```bash
git add app/api/v1/templates/\[id\]/route.ts app/api/v1/templates/\[id\]/apply/route.ts
git commit -m "fix: await Promise-wrapped params in template routes (Next 15)"
```

---

### Task 4: Fix `networks/[nwid]/route.ts`

**Files:**
- Modify: `app/api/v1/networks/[nwid]/route.ts`
- Test: `tests/integration/networks-routes.test.ts`

**Interfaces:**
- Consumes: `deleteNetwork`, `getNetwork`, `updateNetwork`, `updateNetworkSchema` from `@/lib/services/networks` (unchanged).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Update the test call sites**

In `tests/integration/networks-routes.test.ts`, seven call sites use the pattern `params: { nwid: ... }` or `{ params: { nwid: ... } }` (some multi-line, some inline) at lines 124, 130, 139, 150, 168, 178, 185. Run this command to convert all of them mechanically (they are all flat single-line objects with no nested braces, confirmed safe):

Run: `sed -i -E 's/params: \{ ([^{}]*) \}/params: Promise.resolve({ \1 })/g' tests/integration/networks-routes.test.ts`

- [ ] **Step 2: Verify the substitution**

Run: `grep -n "params:" tests/integration/networks-routes.test.ts`
Expected: every line shows `params: Promise.resolve({ nwid: ... })`, e.g.:

```
      params: Promise.resolve({ nwid: NWID }),
      params: Promise.resolve({ nwid: '0000000000000000' }),
      { params: Promise.resolve({ nwid: NWID }) },
```

- [ ] **Step 3: Confirm the type mismatch**

Run: `npx tsc --noEmit`
Expected: FAILS with a type error in `app/api/v1/networks/[nwid]/route.ts` (the `Ctx` type there still expects a plain object, but the test now passes a `Promise`).

- [ ] **Step 4: Rewrite the route file**

Replace the full contents of `app/api/v1/networks/[nwid]/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api/auth';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import {
  deleteNetwork,
  getNetwork,
  updateNetwork,
  updateNetworkSchema,
} from '@/lib/services/networks';

type Ctx = { params: Promise<{ nwid: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const { nwid } = await params;
    const network = await getNetwork(nwid);
    if (!network) return apiError('NOT_FOUND', `Network ${nwid} not found.`, 404);
    return NextResponse.json({ network });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const { nwid } = await params;
    const body = updateNetworkSchema.parse(await req.json());
    const before = await getNetwork(nwid).catch(() => null);
    const { data, metaWarning } = await updateNetwork(nwid, body);
    await logAudit({
      userId: auth.user.id,
      action: 'network.update',
      targetType: 'network',
      targetId: nwid,
      detail: { before, after: body },
    });
    return NextResponse.json({ network: data, metaWarning });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const { nwid } = await params;
    await deleteNetwork(nwid);
    await logAudit({
      userId: auth.user.id,
      action: 'network.delete',
      targetType: 'network',
      targetId: nwid,
    });
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleRouteError(e);
  }
}
```

- [ ] **Step 5: Run typecheck and the test suite**

Run: `npx tsc --noEmit && npx vitest run tests/integration/networks-routes.test.ts`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/v1/networks/\[nwid\]/route.ts tests/integration/networks-routes.test.ts
git commit -m "fix: await Promise-wrapped params in network detail route (Next 15)"
```

---

### Task 5: Fix `networks/[nwid]/clone/route.ts`

**Files:**
- Modify: `app/api/v1/networks/[nwid]/clone/route.ts`

**Interfaces:**
- Consumes: `cloneNetwork(nwid: string)` from `@/lib/services/networks` (unchanged).
- Produces: nothing new — no dedicated integration test calls this handler directly (clone behavior is covered by `tests/unit/clone-network.test.ts` at the service layer).

- [ ] **Step 1: Rewrite the route file**

Replace the full contents of `app/api/v1/networks/[nwid]/clone/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api/auth';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import { cloneNetwork } from '@/lib/services/networks';

type Ctx = { params: Promise<{ nwid: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const { nwid } = await params;
    const result = await cloneNetwork(nwid);
    if (!result) return apiError('NOT_FOUND', `Network ${nwid} not found.`, 404);
    await logAudit({
      userId: auth.user.id,
      action: 'network.clone',
      targetType: 'network',
      targetId: result.data.nwid,
      detail: { from: nwid },
    });
    return NextResponse.json({ network: result.data, metaWarning: result.metaWarning }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}
```

- [ ] **Step 2: Run typecheck and the clone-network test suite**

Run: `npx tsc --noEmit && npx vitest run tests/unit/clone-network.test.ts`
Expected: both PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/v1/networks/\[nwid\]/clone/route.ts
git commit -m "fix: await Promise-wrapped params in network clone route (Next 15)"
```

---

### Task 6: Fix `networks/[nwid]/members/route.ts` and `members/[memberId]/route.ts`

**Files:**
- Modify: `app/api/v1/networks/[nwid]/members/route.ts`
- Modify: `app/api/v1/networks/[nwid]/members/[memberId]/route.ts`
- Test: `tests/integration/members-routes.test.ts`

**Interfaces:**
- Consumes: `listMembers(nwid: string)`, `getMember(nwid, memberId)`, `updateMember(nwid, memberId, body)`, `updateMemberSchema`, `deleteMember(nwid, memberId)` from `@/lib/services/members` (unchanged); `sampleNetworkPresence(nwid)` from `@/lib/services/presence` (unchanged); `notifyNewUnauthorizedMembers(nwid)` from `@/lib/services/webhooks` (unchanged).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Update the test call sites**

`tests/integration/members-routes.test.ts` has seven `params:` call sites at lines 77, 84 (both `{ nwid: NWID }`, for the list route) and 96, 108, 126, 143, 152 (all `{ nwid: NWID, memberId: ... }`, for the member-detail routes) — all flat single-line objects, safe for the same mechanical substitution:

Run: `sed -i -E 's/params: \{ ([^{}]*) \}/params: Promise.resolve({ \1 })/g' tests/integration/members-routes.test.ts`

- [ ] **Step 2: Verify the substitution**

Run: `grep -n "params:" tests/integration/members-routes.test.ts`
Expected: every line shows `Promise.resolve({...})`, e.g. `{ params: Promise.resolve({ nwid: NWID, memberId: MID }) },`.

- [ ] **Step 3: Confirm the type mismatch**

Run: `npx tsc --noEmit`
Expected: FAILS with type errors in both `app/api/v1/networks/[nwid]/members/route.ts` and `app/api/v1/networks/[nwid]/members/[memberId]/route.ts`.

- [ ] **Step 4: Rewrite `app/api/v1/networks/[nwid]/members/route.ts`**

Replace the full contents (only the `Ctx` type and the `GET` handler's param access change; the two throttle helper functions are untouched):

```typescript
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api/auth';
import { handleRouteError } from '@/lib/api/errors';
import { listMembers } from '@/lib/services/members';
import { sampleNetworkPresence } from '@/lib/services/presence';
import { notifyNewUnauthorizedMembers } from '@/lib/services/webhooks';

type Ctx = { params: Promise<{ nwid: string }> };

// Throttle presence sampling per-network so a busy members list (polled every
// 10s per open tab) doesn't write a presence row on every request. This is a
// deliberately honest limitation: presence is only ever sampled while someone
// has the members list open — there is no background scheduler, so a network
// nobody is viewing accumulates no history.
const SAMPLE_INTERVAL_MS = 60_000;
const lastSampledAt = new Map<string, number>();

async function maybeSamplePresence(nwid: string, now: number): Promise<void> {
  const last = lastSampledAt.get(nwid) ?? 0;
  if (now - last < SAMPLE_INTERVAL_MS) return;
  lastSampledAt.set(nwid, now);
  // sampleNetworkPresence never throws (best-effort, like audit/retention); we
  // still await it so it completes deterministically before the response.
  await sampleNetworkPresence(nwid);
}

// Same throttling shape as presence sampling above, but for the "new
// unauthorized member" webhook check — kept as a separate map/interval so the
// two features can be tuned independently. Same honest limitation applies:
// this only fires while someone is viewing the network's member list, since
// there is no background scheduler.
const WEBHOOK_CHECK_INTERVAL_MS = 30_000;
const lastWebhookCheckAt = new Map<string, number>();

async function maybeCheckNewMemberWebhook(nwid: string, now: number): Promise<void> {
  const last = lastWebhookCheckAt.get(nwid) ?? 0;
  if (now - last < WEBHOOK_CHECK_INTERVAL_MS) return;
  lastWebhookCheckAt.set(nwid, now);
  // notifyNewUnauthorizedMembers never throws (best-effort, like presence
  // sampling); we still await it so it completes deterministically before the
  // response, without risking the response on failure.
  await notifyNewUnauthorizedMembers(nwid);
}

export async function GET(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const { nwid } = await params;
    const members = await listMembers(nwid);
    const now = Date.now();
    await maybeSamplePresence(nwid, now);
    await maybeCheckNewMemberWebhook(nwid, now);
    return NextResponse.json({ members });
  } catch (e) {
    return handleRouteError(e);
  }
}
```

- [ ] **Step 5: Rewrite `app/api/v1/networks/[nwid]/members/[memberId]/route.ts`**

Replace the full contents:

```typescript
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api/auth';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import {
  deleteMember,
  getMember,
  updateMember,
  updateMemberSchema,
} from '@/lib/services/members';

type Ctx = { params: Promise<{ nwid: string; memberId: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const { nwid, memberId } = await params;
    const member = await getMember(nwid, memberId);
    if (!member) return apiError('NOT_FOUND', `Member ${memberId} not found.`, 404);
    return NextResponse.json({ member });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const { nwid, memberId } = await params;
    const body = updateMemberSchema.parse(await req.json());
    const before = await getMember(nwid, memberId).catch(() => null);
    const { data, metaWarning } = await updateMember(nwid, memberId, body);
    await logAudit({
      userId: auth.user.id,
      action: 'member.update',
      targetType: 'member',
      targetId: `${nwid}/${memberId}`,
      detail: { before, after: body },
    });
    return NextResponse.json({ member: data, metaWarning });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const { nwid, memberId } = await params;
    await deleteMember(nwid, memberId);
    await logAudit({
      userId: auth.user.id,
      action: 'member.delete',
      targetType: 'member',
      targetId: `${nwid}/${memberId}`,
    });
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleRouteError(e);
  }
}
```

- [ ] **Step 6: Run typecheck and the test suite**

Run: `npx tsc --noEmit && npx vitest run tests/integration/members-routes.test.ts`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add app/api/v1/networks/\[nwid\]/members/route.ts app/api/v1/networks/\[nwid\]/members/\[memberId\]/route.ts tests/integration/members-routes.test.ts
git commit -m "fix: await Promise-wrapped params in member routes (Next 15)"
```

---

### Task 7: Fix `networks/[nwid]/presence/route.ts`

**Files:**
- Modify: `app/api/v1/networks/[nwid]/presence/route.ts`
- Test: `tests/integration/presence-route.test.ts`

**Interfaces:**
- Consumes: `getNetworkPresence(nwid: string)` from `@/lib/services/presence` (unchanged).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Update the test call sites**

`tests/integration/presence-route.test.ts` has two call sites at lines 47 and 57, both `params: { nwid: NWID }`:

Run: `sed -i -E 's/params: \{ ([^{}]*) \}/params: Promise.resolve({ \1 })/g' tests/integration/presence-route.test.ts`

- [ ] **Step 2: Verify the substitution**

Run: `grep -n "params:" tests/integration/presence-route.test.ts`
Expected: both lines show `params: Promise.resolve({ nwid: NWID }),`.

- [ ] **Step 3: Confirm the type mismatch**

Run: `npx tsc --noEmit`
Expected: FAILS with a type error in `app/api/v1/networks/[nwid]/presence/route.ts`.

- [ ] **Step 4: Rewrite the route file**

Replace the full contents of `app/api/v1/networks/[nwid]/presence/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api/auth';
import { handleRouteError } from '@/lib/api/errors';
import { getNetworkPresence } from '@/lib/services/presence';

type Ctx = { params: Promise<{ nwid: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const { nwid } = await params;
    return NextResponse.json({ presence: await getNetworkPresence(nwid) });
  } catch (e) {
    return handleRouteError(e);
  }
}
```

- [ ] **Step 5: Run typecheck and the test suite**

Run: `npx tsc --noEmit && npx vitest run tests/integration/presence-route.test.ts`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/v1/networks/\[nwid\]/presence/route.ts tests/integration/presence-route.test.ts
git commit -m "fix: await Promise-wrapped params in presence route (Next 15)"
```

---

### Task 8: Fix `networks/[nwid]/rules/route.ts`

**Files:**
- Modify: `app/api/v1/networks/[nwid]/rules/route.ts`
- Test: `tests/integration/rules-routes.test.ts`

**Interfaces:**
- Consumes: `getRules(nwid: string)`, `setRules(nwid, source)` from `@/lib/services/rules` (unchanged).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Update the test call sites**

`tests/integration/rules-routes.test.ts` has eleven `params:` call sites (lines 57, 63, 85, 86, 94, 110, 123, 124, 131, 142, 150), all flat single-line `{ nwid: ... }` objects:

Run: `sed -i -E 's/params: \{ ([^{}]*) \}/params: Promise.resolve({ \1 })/g' tests/integration/rules-routes.test.ts`

- [ ] **Step 2: Verify the substitution**

Run: `grep -c "Promise.resolve" tests/integration/rules-routes.test.ts`
Expected: `11`.

- [ ] **Step 3: Confirm the type mismatch**

Run: `npx tsc --noEmit`
Expected: FAILS with a type error in `app/api/v1/networks/[nwid]/rules/route.ts`.

- [ ] **Step 4: Rewrite the route file**

Replace the full contents of `app/api/v1/networks/[nwid]/rules/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/api/auth';
import { handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import { getRules, setRules } from '@/lib/services/rules';

type Ctx = { params: Promise<{ nwid: string }> };

const putRulesSchema = z.object({ source: z.string().min(1).max(65536) }).strict();

export async function GET(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const { nwid } = await params;
    return NextResponse.json(await getRules(nwid));
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const { nwid } = await params;
    const body = putRulesSchema.parse(await req.json());
    const before = await getRules(nwid)
      .then((r) => r.source)
      .catch(() => null);
    const { data, metaWarning } = await setRules(nwid, body.source);
    await logAudit({
      userId: auth.user.id,
      action: 'network.rules.update',
      targetType: 'network',
      targetId: nwid,
      detail: { before, after: body.source },
    });
    return NextResponse.json({ ...data, metaWarning });
  } catch (e) {
    return handleRouteError(e);
  }
}
```

- [ ] **Step 5: Run typecheck and the test suite**

Run: `npx tsc --noEmit && npx vitest run tests/integration/rules-routes.test.ts`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/v1/networks/\[nwid\]/rules/route.ts tests/integration/rules-routes.test.ts
git commit -m "fix: await Promise-wrapped params in rules route (Next 15)"
```

---

### Task 9: Fix the network detail and join pages

**Files:**
- Modify: `app/(ui)/networks/[nwid]/page.tsx`
- Modify: `app/(ui)/networks/[nwid]/join/page.tsx`

**Interfaces:**
- Consumes: `NetworkSettings`, `MemberTable`, `RoutesEditor`, `DnsEditor`, `RulesEditor`, `NetworkActions` (all take a `nwid: string` prop, unchanged) from `@/components/networks/*` and `@/components/members/MemberTable`; `JoinInstructions` (`nwid: string` prop, unchanged) from `@/components/networks/JoinInstructions`.
- Produces: nothing new — no test imports these page components directly (confirmed: no test file references `NetworkDetailPage` or `JoinNetworkPage`).

- [ ] **Step 1: Rewrite `app/(ui)/networks/[nwid]/page.tsx`**

Page components' `params` prop also becomes a `Promise` in Next 15, and the component itself must become `async`:

```typescript
import { NetworkSettings } from '@/components/networks/NetworkSettings';
import { MemberTable } from '@/components/members/MemberTable';
import { RoutesEditor } from '@/components/networks/RoutesEditor';
import { DnsEditor } from '@/components/networks/DnsEditor';
import { RulesEditor } from '@/components/networks/RulesEditor';
import { NetworkActions } from '@/components/networks/NetworkActions';

export default async function NetworkDetailPage({
  params,
}: {
  params: Promise<{ nwid: string }>;
}) {
  const { nwid } = await params;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[28px] wght-540 tracking-[-0.63px]">Network</h1>
        <p className="text-sm text-ink-mute font-mono">{nwid}</p>
      </div>
      <NetworkSettings nwid={nwid} />
      <MemberTable nwid={nwid} />
      <RoutesEditor nwid={nwid} />
      <DnsEditor nwid={nwid} />
      <RulesEditor nwid={nwid} />
      <NetworkActions nwid={nwid} />
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `app/(ui)/networks/[nwid]/join/page.tsx`**

```typescript
import Link from 'next/link';
import { JoinInstructions } from '@/components/networks/JoinInstructions';

export default async function JoinNetworkPage({
  params,
}: {
  params: Promise<{ nwid: string }>;
}) {
  const { nwid } = await params;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[28px] wght-540 tracking-[-0.63px]">Join network</h1>
        <p className="text-sm text-ink-mute font-mono mt-1">{nwid}</p>
      </div>

      <p className="text-sm text-ink-mute">
        Install ZeroTier on the device you want to join, then run the command for your platform
        below.{' '}
        <a
          href="https://www.zerotier.com/download/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline"
        >
          Download ZeroTier
        </a>
      </p>

      <JoinInstructions nwid={nwid} />

      <p className="text-sm text-ink-mute">
        After joining, an admin must authorize the device on the{' '}
        <Link href={`/networks/${nwid}`} className="text-primary underline">
          network page
        </Link>{' '}
        before it can communicate.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASSES with zero errors — this should be the last of the 10 files fixed, so no remaining `params`-shape mismatches anywhere in the tree.

- [ ] **Step 4: Commit**

```bash
git add "app/(ui)/networks/[nwid]/page.tsx" "app/(ui)/networks/[nwid]/join/page.tsx"
git commit -m "fix: await Promise-wrapped params in network detail/join pages (Next 15)"
```

---

### Task 10: Full verification, audit confirmation, and TODO update

**Files:**
- Modify: `TODO.md`
- Modify: `Completed_TODO.md`

**Interfaces:** None — this is a verification-and-bookkeeping task, no new code interfaces.

- [ ] **Step 1: Run the full typecheck, lint, and test suite**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all three exit 0. If `npm run lint` reports new findings from the `eslint-config-next` bump, fix them for real (do not add `eslint-disable` comments) before proceeding.

- [ ] **Step 2: Run a production build**

Run: `npm run build`
Expected: exits 0. This is the strongest signal for this migration — Next's build step type-checks route/page handler signatures against its own generated `.next/types`, which is the authoritative check for the async-`params` change (plain `tsc --noEmit` only catches it because the test files were updated to pass `Promise`-wrapped params; the build step would catch it even without that).

- [ ] **Step 3: Manual smoke test in the dev server**

Run: `npm run dev` (in the background or a separate terminal)
- Open `/networks/<a-real-nwid>` and confirm the page loads and shows the nwid, member table, routes editor, DNS editor, rules editor, and actions panel without errors.
- Open `/networks/<a-real-nwid>/join` and confirm it loads and shows the nwid and join instructions.
- Issue one API call directly, e.g. `curl -i http://localhost:3000/api/v1/networks/<a-real-nwid>` with a valid session cookie, and confirm it returns the network JSON (not a 404 from a broken `params.nwid` read).

Stop the dev server when done.

- [ ] **Step 4: Confirm the CVEs are cleared**

Run: `npm audit --json`
Expected: no findings with `"name": "next"` or `"name": "eslint-config-next"` (or their transitive `@next/eslint-plugin-next`/`glob` chain) in the output. The only remaining findings should be the pre-known `vitest`/`esbuild` moderate finding (out of scope per the spec) and anything unrelated to this upgrade.

- [ ] **Step 5: Update `TODO.md`**

In `TODO.md`, remove item 1 under "P1 — high value, do next" (the "Next 14 → 15/16 major upgrade" line) since it's now done. Renumber the remaining P1 items 2-4 down to 1-3.

- [ ] **Step 6: Add the completed item to `Completed_TODO.md`**

Append to the end of the "Tooling / CI / deps" section (or create one near the top if the file's structure has changed) in `Completed_TODO.md`:

```markdown
- ✅ **[DONE] [P1] Next.js 14 → 15 upgrade, clearing all `next`-related CVEs.** *(Fixed
  2026-07-03: bumped to the latest 15.5.x; the only breaking change hit was async
  `params`/page-props across 10 route/page files, all converted to
  `Promise<{...}>` + `await`. See `docs/superpowers/specs/2026-07-03-nextjs-15-upgrade-design.md`.)*
```

- [ ] **Step 7: Commit**

```bash
git add TODO.md Completed_TODO.md
git commit -m "docs: mark Next.js 15 upgrade complete in TODO"
```
