# Account Settings & Frictionless Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the manual setup-token step from first-run account creation, and add a logged-in account settings page for changing your password and enrolling/disabling TOTP-based 2FA.

**Architecture:** Next.js 15 App Router + Route Handlers (`app/api/v1/*`) as the REST API, Prisma/SQLite for storage, argon2 for password hashing, a hand-rolled RFC 6238 TOTP service (`lib/services/totp.ts`) already wired to login. This plan removes the `GEMZT_SETUP_TOKEN` gate, adds two new authenticated routes (`PATCH /api/v1/auth/password`, `POST /api/v1/auth/totp/disable`), extends `GET /api/v1/me`, and adds a new `/account` UI page composed of two new client components.

**Tech Stack:** TypeScript, Next.js 15 (App Router), Prisma (SQLite), Zod, argon2, Vitest + Testing Library, Tailwind. One new runtime dependency: `qrcode` (pure-JS QR rendering, no native deps) + its `@types/qrcode` dev dependency, for rendering the TOTP enrollment QR code client-side.

## Global Constraints

- Setup token requirement is removed entirely; `needsSetup` (zero users in the `User` table) remains the only gate on `/api/v1/setup`. The existing per-IP rate limiter on `/api/v1/setup` (10 attempts / 15 min, `GEMZT_SETUP_MAX_ATTEMPTS` / `GEMZT_SETUP_WINDOW_MS`) is unchanged.
- Password change requires the current password and a new password (min 10 chars, same rule as account creation); on success every other session for that user is deleted, but the session that made the request stays valid.
- TOTP disable requires the current password (not a TOTP code).
- All new/changed API error codes and response shapes follow the existing envelope: `{ error: { code, message } }` via `apiError()`/`handleRouteError()` from `lib/api/errors.ts`.
- Every mutating route call is wrapped by `requireAuth()` (`lib/api/auth.ts`), which accepts either the `gemzt_session` cookie or a `ztk_` API key bearer token.
- New routes get OpenAPI entries in `lib/api/openapi.ts` and a corresponding row in the `expected` list in `tests/unit/openapi.test.ts` (existing project convention — see that test's "documents every implemented endpoint" check).
- Passkeys/WebAuthn are explicitly out of scope for this plan (see the design spec, §8).

---

### Task 1: Remove the setup-token requirement

**Files:**

- Modify: `app/api/v1/setup/route.ts`
- Modify: `app/api/v1/setup/status/route.ts`
- Modify: `app/(auth)/setup/page.tsx`
- Delete: `tests/integration/setup-token.test.ts`
- Modify: `tests/integration/setup-auth-routes.test.ts`
- Modify: `tests/ui/auth-pages.test.tsx`
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `README.md`

**Interfaces:**

- Produces: `GET /api/v1/setup/status` now responds `{ needsSetup: boolean }` (no `requiresToken` field). `POST /api/v1/setup` no longer accepts or checks a `setupToken` field.

- [ ] **Step 1: Update the failing/changing tests first — rewrite `tests/integration/setup-auth-routes.test.ts`**

Replace the whole file:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import { GET as setupStatusGet } from '@/app/api/v1/setup/status/route';
import { POST as setupPost } from '@/app/api/v1/setup/route';
import { POST as loginPost } from '@/app/api/v1/auth/login/route';
import { POST as logoutPost } from '@/app/api/v1/auth/logout/route';
import { GET as meGet } from '@/app/api/v1/me/route';

beforeAll(() => {
  setupTestDb();
});

afterAll(async () => {
  await getDb().$disconnect();
});

function jsonReq(
  url: string,
  method: string,
  body?: unknown,
  headers: Record<string, string> = {}
) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('setup + auth routes', () => {
  it('reports needsSetup=true before any user exists', async () => {
    const res = await setupStatusGet();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ needsSetup: true });
  });

  it('rejects invalid setup bodies with VALIDATION_ERROR', async () => {
    const res = await setupPost(jsonReq('http://x/api/v1/setup', 'POST', { username: 'a' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('creates the initial admin, sets a session cookie, then reports needsSetup=false', async () => {
    const res = await setupPost(
      jsonReq('http://x/api/v1/setup', 'POST', { username: 'admin', password: 'password12345' })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.username).toBe('admin');
    expect(body.user).not.toHaveProperty('passwordHash');
    expect(res.headers.get('set-cookie')).toContain('gemzt_session=');
    expect(await (await setupStatusGet()).json()).toEqual({ needsSetup: false });
  });

  it('refuses setup once a user exists (409 SETUP_ALREADY_COMPLETE)', async () => {
    const res = await setupPost(
      jsonReq('http://x/api/v1/setup', 'POST', { username: 'again', password: 'password12345' })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('SETUP_ALREADY_COMPLETE');
  });

  it('logs in with valid credentials and sets the cookie', async () => {
    const res = await loginPost(
      jsonReq('http://x/api/v1/auth/login', 'POST', {
        username: 'admin',
        password: 'password12345',
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('gemzt_session=');
    expect(res.headers.get('set-cookie')).toContain('HttpOnly');
  });

  it('rejects bad credentials with 401', async () => {
    const res = await loginPost(
      jsonReq('http://x/api/v1/auth/login', 'POST', { username: 'admin', password: 'wrong' })
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHORIZED');
  });

  it('GET /me returns the current user with a session cookie, 401 without', async () => {
    const login = await loginPost(
      jsonReq('http://x/api/v1/auth/login', 'POST', {
        username: 'admin',
        password: 'password12345',
      })
    );
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    const ok = await meGet(new Request('http://x/api/v1/me', { headers: { cookie } }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).user.username).toBe('admin');
    const anon = await meGet(new Request('http://x/api/v1/me'));
    expect(anon.status).toBe(401);
  });

  it('logout deletes the session and clears the cookie', async () => {
    const login = await loginPost(
      jsonReq('http://x/api/v1/auth/login', 'POST', {
        username: 'admin',
        password: 'password12345',
      })
    );
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    const res = await logoutPost(
      new Request('http://x/api/v1/auth/logout', {
        method: 'POST',
        headers: { cookie },
      })
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    const me = await meGet(new Request('http://x/api/v1/me', { headers: { cookie } }));
    expect(me.status).toBe(401);
  });
});
```

(This drops the now-pointless `GEMZT_SETUP_TOKEN` save/restore scaffolding and the `requiresToken` assertions.)

- [ ] **Step 2: Delete the token-only test file**

```bash
git rm tests/integration/setup-token.test.ts
```

- [ ] **Step 3: Run the setup integration tests and confirm they fail (route code not yet changed)**

Run: `npx vitest run tests/integration/setup-auth-routes.test.ts`
Expected: FAIL — `needsSetup: true` response still includes `requiresToken: false`, so `toEqual({ needsSetup: true })` fails.

- [ ] **Step 4: Remove the token check from `app/api/v1/setup/route.ts`**

Replace the whole file:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { clientIp } from '@/lib/api/net';
import { createRateLimiter } from '@/lib/services/rateLimit';
import {
  createSession,
  createUser,
  SESSION_COOKIE,
  sessionCookieOptions,
  userCount,
} from '@/lib/services/auth';

// Per-IP limiter on setup attempts. Setup re-opens if app_data is ever lost, so an
// exposed instance still needs a throttle even with no token gate.
const SETUP_MAX_ATTEMPTS = Number(process.env.GEMZT_SETUP_MAX_ATTEMPTS ?? 10);
const SETUP_WINDOW_MS = Number(process.env.GEMZT_SETUP_WINDOW_MS ?? 15 * 60 * 1000);
const setupLimiter = createRateLimiter({ limit: SETUP_MAX_ATTEMPTS, windowMs: SETUP_WINDOW_MS });

const setupSchema = z
  .object({
    username: z.string().min(3).max(32),
    password: z.string().min(10).max(128),
  })
  .strict();

export async function POST(req: Request) {
  try {
    const ipKey = clientIp(req);
    const gate = setupLimiter.check(ipKey);
    if (!gate.allowed) {
      return apiError('RATE_LIMITED', 'Too many setup attempts. Try again later.', 429, {
        'Retry-After': String(Math.ceil(gate.retryAfterMs / 1000)),
      });
    }
    const body = setupSchema.parse(await req.json());
    if ((await userCount()) > 0) {
      return apiError('SETUP_ALREADY_COMPLETE', 'Setup has already been completed.', 409);
    }
    const user = await createUser(body.username, body.password);
    const session = await createSession(user.id);
    const res = NextResponse.json(
      { user: { id: user.id, username: user.username, role: user.role } },
      { status: 201 }
    );
    res.cookies.set(SESSION_COOKIE, session.id, sessionCookieOptions());
    return res;
  } catch (e) {
    return handleRouteError(e);
  }
}
```

- [ ] **Step 5: Drop `requiresToken` from `app/api/v1/setup/status/route.ts`**

Replace the whole file:

```ts
import { NextResponse } from 'next/server';
import { userCount } from '@/lib/services/auth';
import { handleRouteError } from '@/lib/api/errors';

// Hits the database per request; must never be statically prerendered at build
// time (no DATABASE_URL then, and the result must be live for first-run detection).
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({
      needsSetup: (await userCount()) === 0,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
```

- [ ] **Step 6: Run the setup integration tests again**

Run: `npx vitest run tests/integration/setup-auth-routes.test.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 7: Remove the token field from the setup page — `app/(auth)/setup/page.tsx`**

Replace the whole file:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

export default function SetupPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    const res = await fetch('/api/v1/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    setBusy(false);
    if (res.ok) {
      router.push('/networks');
      return;
    }
    const body = await res.json().catch(() => null);
    setError(body?.error?.message ?? 'Setup failed.');
  }

  return (
    <Card className="w-full max-w-sm">
      <h1 className="wght-540 mb-2 text-[22px] tracking-[-0.315px]">Welcome to GEM-ZT</h1>
      <p className="mb-6 text-sm text-ink-mute">
        First-run setup: create the administrator account. No default passwords, ever.
      </p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="text-sm text-ink-mute">
          Username
          <Input value={username} onChange={e => setUsername(e.target.value)} required />
        </label>
        <label className="text-sm text-ink-mute">
          Password
          <Input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            minLength={10}
            required
          />
        </label>
        <label className="text-sm text-ink-mute">
          Confirm password
          <Input
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            required
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-ink">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy}>
          Create admin account
        </Button>
      </form>
    </Card>
  );
}
```

- [ ] **Step 8: Update the setup-page UI tests — `tests/ui/auth-pages.test.tsx`**

Replace the `describe('SetupPage', ...)` block (keep the `LoginPage` block above it untouched) with:

```tsx
describe('SetupPage', () => {
  function stubSetupFetch() {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ user: {} }), { status: 201 })
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('refuses to submit when passwords do not match (no POST)', async () => {
    const fetchMock = stubSetupFetch();
    renderWithQuery(<SetupPage />);
    await userEvent.type(screen.getByLabelText(/username/i), 'admin');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'password12345');
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'different');
    await userEvent.click(screen.getByRole('button', { name: /create admin account/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs username + password to /api/v1/setup and redirects to /networks on success', async () => {
    const fetchMock = stubSetupFetch();
    renderWithQuery(<SetupPage />);
    await userEvent.type(screen.getByLabelText(/username/i), 'admin');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'password12345');
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'password12345');
    await userEvent.click(screen.getByRole('button', { name: /create admin account/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/networks'));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/setup');
    expect(JSON.parse(init!.body as string)).toEqual({
      username: 'admin',
      password: 'password12345',
    });
  });
});
```

- [ ] **Step 9: Run the UI auth-pages tests**

Run: `npx vitest run tests/ui/auth-pages.test.tsx`
Expected: PASS (2 `LoginPage` tests + 2 `SetupPage` tests)

- [ ] **Step 10: Remove `GEMZT_SETUP_TOKEN` from `.env.example`**

Delete these lines from `.env.example` (the block right after the `ZT_AUTH_TOKEN` comment):

```
# Optional but recommended: require this token to create the admin account at
# first-run setup. Guards the unauthenticated /setup endpoint (incl. the case where
# app_data is lost and setup silently re-opens). Generate one, e.g.:
#   openssl rand -hex 32
# GEMZT_SETUP_TOKEN=
```

- [ ] **Step 11: Remove `GEMZT_SETUP_TOKEN` from `docker-compose.yml`**

In the `app.environment` list, delete:

```yaml
# Optional but recommended: set GEMZT_SETUP_TOKEN in a .env file to require a
# token when creating the admin account (guards first-run + app_data-loss re-open).
- GEMZT_SETUP_TOKEN=${GEMZT_SETUP_TOKEN:-}
```

- [ ] **Step 12: Update `README.md`**

Replace this bullet in the "Security & exposure" section:

```
- **Set `GEMZT_SETUP_TOKEN` to lock down first-run setup.** The `/setup` endpoint that creates the
  admin account is unauthenticated until a user exists — so whoever reaches the app first can claim
  it, including if `app_data` is ever lost and setup silently re-opens. Generate a token
  (`openssl rand -hex 32`), put it in a `.env` file next to the compose file, and the wizard will
  require it to create the admin. Highly recommended if the panel is reachable by anyone but you.
```

with:

```
- **`/setup` is only reachable while no admin account exists.** It creates the first admin with no
  token or default password; once that account exists, the endpoint refuses every further request
  (`409 SETUP_ALREADY_COMPLETE`) — including if `app_data` is ever lost and setup silently re-opens,
  at which point whoever reaches the app first claims it again. Don't expose the panel to anyone you
  don't want to risk racing you to finish setup.
```

And delete this row from the "Configuration" table:

```
| `GEMZT_SETUP_TOKEN` | *(unset)* | If set, required to create the admin at first-run setup |
```

- [ ] **Step 13: Commit**

```bash
git add app/api/v1/setup/route.ts app/api/v1/setup/status/route.ts app/\(auth\)/setup/page.tsx \
  tests/integration/setup-auth-routes.test.ts tests/ui/auth-pages.test.tsx \
  .env.example docker-compose.yml README.md
git commit -m "feat: remove setup-token requirement for first-run account creation"
```

---

### Task 2: Add password-change and session-invalidation helpers to the auth service

**Files:**

- Modify: `lib/services/auth.ts`
- Modify: `tests/unit/auth-service.test.ts`

**Interfaces:**

- Produces: `setPassword(userId: string, password: string): Promise<void>` — hashes `password` and updates `User.passwordHash`.
- Produces: `invalidateOtherSessions(userId: string, exceptSessionId?: string): Promise<number>` — deletes every `Session` row for `userId` except `exceptSessionId` (deletes all of that user's sessions if `exceptSessionId` is omitted). Returns the number of rows deleted.

- [ ] **Step 1: Write the failing tests — append to `tests/unit/auth-service.test.ts`**

Add these two `it` blocks inside the existing `describe('auth service', ...)` block (after the last existing test, before the closing `});`), and add `setPassword` and `invalidateOtherSessions` to the import list at the top:

```ts
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  hashPassword,
  verifyPassword,
  userCount,
  createUser,
  createSession,
  login,
  getSession,
  logout,
  sessionCookieOptions,
  clearSessionCookieHeader,
  purgeExpiredSessions,
  setPassword,
  invalidateOtherSessions,
} from '@/lib/services/auth';
```

```ts
it('setPassword replaces the password hash so the old password no longer verifies', async () => {
  const user = await createUser('password-change-user', 'password12345');
  await setPassword(user.id, 'new-password-999');
  const updated = await getDb().user.findUniqueOrThrow({ where: { id: user.id } });
  expect(await verifyPassword(updated.passwordHash, 'new-password-999')).toBe(true);
  expect(await verifyPassword(updated.passwordHash, 'password12345')).toBe(false);
});

it('invalidateOtherSessions deletes every session for the user except the excluded one', async () => {
  const user = await createUser('multi-session-user', 'password12345');
  const kept = await createSession(user.id);
  const a = await createSession(user.id);
  const b = await createSession(user.id);
  const removed = await invalidateOtherSessions(user.id, kept.id);
  expect(removed).toBe(2);
  expect(await getSession(kept.id)).not.toBeNull();
  expect(await getSession(a.id)).toBeNull();
  expect(await getSession(b.id)).toBeNull();
});

it('invalidateOtherSessions with no exception deletes every session for the user', async () => {
  const user = await createUser('all-sessions-user', 'password12345');
  const a = await createSession(user.id);
  const b = await createSession(user.id);
  const removed = await invalidateOtherSessions(user.id);
  expect(removed).toBe(2);
  expect(await getSession(a.id)).toBeNull();
  expect(await getSession(b.id)).toBeNull();
});

it("invalidateOtherSessions never touches another user's sessions", async () => {
  const userA = await createUser('session-owner-a', 'password12345');
  const userB = await createUser('session-owner-b', 'password12345');
  const sessionA = await createSession(userA.id);
  const sessionB = await createSession(userB.id);
  await invalidateOtherSessions(userA.id);
  expect(await getSession(sessionA.id)).toBeNull();
  expect(await getSession(sessionB.id)).not.toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/auth-service.test.ts`
Expected: FAIL with `setPassword is not a function` / `invalidateOtherSessions is not a function` (import errors)

- [ ] **Step 3: Implement `setPassword` and `invalidateOtherSessions` in `lib/services/auth.ts`**

Add these two functions at the end of the file (after `purgeExpiredSessions`):

```ts
export async function setPassword(userId: string, password: string): Promise<void> {
  const passwordHash = await hashPassword(password);
  await getDb().user.update({ where: { id: userId }, data: { passwordHash } });
}

/**
 * Delete every session belonging to `userId` except `exceptSessionId` (or all of
 * them, if omitted). Used after a password change so a stolen/other-device
 * session can't outlive the credential that issued it.
 */
export async function invalidateOtherSessions(
  userId: string,
  exceptSessionId?: string
): Promise<number> {
  const where = exceptSessionId ? { userId, id: { not: exceptSessionId } } : { userId };
  const { count } = await getDb().session.deleteMany({ where });
  return count;
}
```

- [ ] **Step 4: Run the tests again to verify they pass**

Run: `npx vitest run tests/unit/auth-service.test.ts`
Expected: PASS (all tests, including the 4 new ones)

- [ ] **Step 5: Commit**

```bash
git add lib/services/auth.ts tests/unit/auth-service.test.ts
git commit -m "feat: add setPassword and invalidateOtherSessions to the auth service"
```

---

### Task 3: Add `PATCH /api/v1/auth/password`

**Files:**

- Create: `app/api/v1/auth/password/route.ts`
- Create: `tests/integration/password-change.test.ts`
- Modify: `lib/api/openapi.ts`
- Modify: `tests/unit/openapi.test.ts`

**Interfaces:**

- Consumes: `requireAuth(req)` from `lib/api/auth.ts` → `{ user: User } | Response`; `verifyPassword(hash, password)`, `setPassword(userId, password)`, `invalidateOtherSessions(userId, exceptSessionId?)`, `SESSION_COOKIE` from `lib/services/auth.ts`; `logAudit(input)` from `lib/services/audit.ts`; `apiError`, `handleRouteError` from `lib/api/errors.ts`; `getDb` from `lib/db/client`.
- Produces: `PATCH /api/v1/auth/password` — body `{ currentPassword: string, newPassword: string }` → `204 No Content` on success (other sessions invalidated), `400 CURRENT_PASSWORD_INVALID` if `currentPassword` is wrong, `400 VALIDATION_ERROR` if the body fails schema validation, `401` if unauthenticated.

- [ ] **Step 1: Write the failing integration test — `tests/integration/password-change.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { createTestUserAndSession } from '../helpers/auth';
import { getDb } from '@/lib/db/client';
import { createSession, getSession, verifyPassword } from '@/lib/services/auth';
import { PATCH as passwordPatch } from '@/app/api/v1/auth/password/route';

beforeAll(() => {
  setupTestDb();
});

afterAll(async () => {
  await getDb().$disconnect();
});

function req(cookie: string, body: unknown) {
  return new Request('http://x/api/v1/auth/password', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/v1/auth/password', () => {
  it('requires auth', async () => {
    const res = await passwordPatch(
      new Request('http://x/api/v1/auth/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: 'password12345', newPassword: 'new-password-999' }),
      })
    );
    expect(res.status).toBe(401);
  });

  it('rejects the wrong current password with 400 CURRENT_PASSWORD_INVALID', async () => {
    const { cookie, user } = await createTestUserAndSession();
    const res = await passwordPatch(
      req(cookie, { currentPassword: 'wrong', newPassword: 'new-password-999' })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('CURRENT_PASSWORD_INVALID');
    const unchanged = await getDb().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword(unchanged.passwordHash, 'password12345')).toBe(true);
  });

  it('rejects a new password shorter than 10 characters with 400 VALIDATION_ERROR', async () => {
    const { cookie } = await createTestUserAndSession();
    const res = await passwordPatch(
      req(cookie, { currentPassword: 'password12345', newPassword: 'short' })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('changes the password, keeps the current session, and invalidates the others', async () => {
    const { cookie, user } = await createTestUserAndSession();
    const otherSession = await createSession(user.id);

    const res = await passwordPatch(
      req(cookie, { currentPassword: 'password12345', newPassword: 'new-password-999' })
    );
    expect(res.status).toBe(204);

    const updated = await getDb().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword(updated.passwordHash, 'new-password-999')).toBe(true);

    const currentSessionId = cookie.split('=')[1];
    expect(await getSession(currentSessionId)).not.toBeNull();
    expect(await getSession(otherSession.id)).toBeNull();
  });

  it('writes an audit log entry on success', async () => {
    const { cookie, user } = await createTestUserAndSession();
    await passwordPatch(
      req(cookie, { currentPassword: 'password12345', newPassword: 'new-password-999' })
    );
    const entry = await getDb().auditLog.findFirst({
      where: { userId: user.id, action: 'user.password_change' },
    });
    expect(entry).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/password-change.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/v1/auth/password/route'`

- [ ] **Step 3: Implement the route — `app/api/v1/auth/password/route.ts`**

```ts
import { z } from 'zod';
import { requireAuth } from '@/lib/api/auth';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { getDb } from '@/lib/db/client';
import { logAudit } from '@/lib/services/audit';
import {
  invalidateOtherSessions,
  SESSION_COOKIE,
  setPassword,
  verifyPassword,
} from '@/lib/services/auth';

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(10).max(128),
  })
  .strict();

export async function PATCH(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const body = passwordSchema.parse(await req.json());
    const user = await getDb().user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (!(await verifyPassword(user.passwordHash, body.currentPassword))) {
      return apiError('CURRENT_PASSWORD_INVALID', 'Current password is incorrect.', 400);
    }
    await setPassword(user.id, body.newPassword);
    const cookieHeader = req.headers.get('cookie') ?? '';
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
    await invalidateOtherSessions(user.id, match?.[1]);
    await logAudit({
      userId: user.id,
      action: 'user.password_change',
      targetType: 'user',
      targetId: user.id,
    });
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleRouteError(e);
  }
}
```

- [ ] **Step 4: Run the test again to verify it passes**

Run: `npx vitest run tests/integration/password-change.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Document the route in the OpenAPI spec — `lib/api/openapi.ts`**

Add this entry to `paths`, immediately after the existing `'/auth/totp/enable'` entry (before `'/me'`):

```ts
    '/auth/password': {
      patch: {
        tags: ['auth'],
        summary: 'Change the current user\'s password; invalidates every other session',
        responses: {
          '204': { description: 'Password changed' },
          '400': errorResponse,
          '401': errorResponse,
        },
      },
    },
```

- [ ] **Step 6: Add the route to the documented-endpoints list — `tests/unit/openapi.test.ts`**

In the `expected` array, add this line immediately after `['/auth/totp/enable', 'post'],`:

```ts
  ['/auth/password', 'patch'],
```

- [ ] **Step 7: Run the openapi test to confirm it still passes**

Run: `npx vitest run tests/unit/openapi.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add app/api/v1/auth/password/route.ts tests/integration/password-change.test.ts \
  lib/api/openapi.ts tests/unit/openapi.test.ts
git commit -m "feat: add PATCH /api/v1/auth/password"
```

---

### Task 4: Expose `totpEnabled` on `GET /api/v1/me`

**Files:**

- Modify: `app/api/v1/me/route.ts`
- Modify: `tests/integration/setup-auth-routes.test.ts`

**Interfaces:**

- Produces: `GET /api/v1/me` now responds `{ user: { id, username, role, totpEnabled } }`.

- [ ] **Step 1: Extend the existing `/me` assertion — `tests/integration/setup-auth-routes.test.ts`**

In the `'GET /me returns the current user...'` test, change:

```ts
expect((await ok.json()).user.username).toBe('admin');
```

to:

```ts
expect((await ok.json()).user).toMatchObject({ username: 'admin', totpEnabled: false });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/setup-auth-routes.test.ts`
Expected: FAIL — `user.totpEnabled` is `undefined`, not `false`

- [ ] **Step 3: Add `totpEnabled` to the response — `app/api/v1/me/route.ts`**

Replace the whole file:

```ts
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api/auth';
import { handleRouteError } from '@/lib/api/errors';

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const { user } = auth;
    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        totpEnabled: user.totpEnabled,
      },
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
```

- [ ] **Step 4: Run the test again to verify it passes**

Run: `npx vitest run tests/integration/setup-auth-routes.test.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/me/route.ts tests/integration/setup-auth-routes.test.ts
git commit -m "feat: expose totpEnabled on GET /api/v1/me"
```

---

### Task 5: Add `POST /api/v1/auth/totp/disable`

**Files:**

- Create: `app/api/v1/auth/totp/disable/route.ts`
- Create: `tests/integration/totp-disable.test.ts`
- Modify: `lib/api/openapi.ts`
- Modify: `tests/unit/openapi.test.ts`

**Interfaces:**

- Consumes: `requireAuth`, `verifyPassword` (from `lib/services/auth.ts`), `getDb`, `logAudit`.
- Produces: `POST /api/v1/auth/totp/disable` — body `{ currentPassword: string }` → `200 { enabled: false }` on success, `400 CURRENT_PASSWORD_INVALID`, `409 TOTP_NOT_ENABLED` if TOTP isn't currently enabled, `401` if unauthenticated.

- [ ] **Step 1: Write the failing integration test — `tests/integration/totp-disable.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { createTestUserAndSession } from '../helpers/auth';
import { getDb } from '@/lib/db/client';
import { totp } from '@/lib/services/totp';
import { POST as enrollPost } from '@/app/api/v1/auth/totp/enroll/route';
import { POST as enablePost } from '@/app/api/v1/auth/totp/enable/route';
import { POST as disablePost } from '@/app/api/v1/auth/totp/disable/route';

beforeAll(() => {
  setupTestDb();
});

afterAll(async () => {
  await getDb().$disconnect();
});

function req(cookie: string, body: unknown) {
  return new Request('http://x/api/v1/auth/totp/disable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
}

async function enableTotpFor(cookie: string): Promise<void> {
  const enrolled = await (
    await enrollPost(
      new Request('http://x/api/v1/auth/totp/enroll', { method: 'POST', headers: { cookie } })
    )
  ).json();
  await enablePost(
    new Request('http://x/api/v1/auth/totp/enable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ code: totp(enrolled.secret) }),
    })
  );
}

describe('POST /api/v1/auth/totp/disable', () => {
  it('requires auth', async () => {
    const res = await disablePost(
      new Request('http://x/api/v1/auth/totp/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: 'password12345' }),
      })
    );
    expect(res.status).toBe(401);
  });

  it('409s with TOTP_NOT_ENABLED when TOTP is not enabled', async () => {
    const { cookie } = await createTestUserAndSession();
    const res = await disablePost(req(cookie, { currentPassword: 'password12345' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('TOTP_NOT_ENABLED');
  });

  it('rejects the wrong password with 400 CURRENT_PASSWORD_INVALID and leaves TOTP enabled', async () => {
    const { cookie, user } = await createTestUserAndSession();
    await enableTotpFor(cookie);
    const res = await disablePost(req(cookie, { currentPassword: 'wrong' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('CURRENT_PASSWORD_INVALID');
    const dbUser = await getDb().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(dbUser.totpEnabled).toBe(true);
  });

  it('disables TOTP and clears the secret on the correct password', async () => {
    const { cookie, user } = await createTestUserAndSession();
    await enableTotpFor(cookie);
    const res = await disablePost(req(cookie, { currentPassword: 'password12345' }));
    expect(res.status).toBe(200);
    expect((await res.json()).enabled).toBe(false);
    const dbUser = await getDb().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(dbUser.totpEnabled).toBe(false);
    expect(dbUser.totpSecret).toBeNull();
  });

  it('writes an audit log entry on success', async () => {
    const { cookie, user } = await createTestUserAndSession();
    await enableTotpFor(cookie);
    await disablePost(req(cookie, { currentPassword: 'password12345' }));
    const entry = await getDb().auditLog.findFirst({
      where: { userId: user.id, action: 'user.totp_disable' },
    });
    expect(entry).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/totp-disable.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/v1/auth/totp/disable/route'`

- [ ] **Step 3: Implement the route — `app/api/v1/auth/totp/disable/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/api/auth';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { getDb } from '@/lib/db/client';
import { logAudit } from '@/lib/services/audit';
import { verifyPassword } from '@/lib/services/auth';

const disableSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
  })
  .strict();

export async function POST(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const body = disableSchema.parse(await req.json());
    const user = await getDb().user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (!user.totpEnabled) {
      return apiError('TOTP_NOT_ENABLED', 'Two-factor authentication is not enabled.', 409);
    }
    if (!(await verifyPassword(user.passwordHash, body.currentPassword))) {
      return apiError('CURRENT_PASSWORD_INVALID', 'Current password is incorrect.', 400);
    }
    await getDb().user.update({
      where: { id: user.id },
      data: { totpSecret: null, totpEnabled: false },
    });
    await logAudit({
      userId: user.id,
      action: 'user.totp_disable',
      targetType: 'user',
      targetId: user.id,
    });
    return NextResponse.json({ enabled: false });
  } catch (e) {
    return handleRouteError(e);
  }
}
```

- [ ] **Step 4: Run the test again to verify it passes**

Run: `npx vitest run tests/integration/totp-disable.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Document the route in the OpenAPI spec — `lib/api/openapi.ts`**

Add this entry to `paths`, immediately after the existing `'/auth/totp/enable'` entry:

```ts
    '/auth/totp/disable': {
      post: {
        tags: ['auth'],
        summary: 'Disable TOTP with the current password; clears the stored secret',
        responses: {
          '200': { description: '{ enabled: false }' },
          '400': errorResponse,
          '409': errorResponse,
        },
      },
    },
```

- [ ] **Step 6: Add the route to the documented-endpoints list — `tests/unit/openapi.test.ts`**

In the `expected` array, add this line immediately after `['/auth/totp/enable', 'post'],` (order doesn't matter relative to the `/auth/password` entry added in Task 3, but keep both together for readability):

```ts
  ['/auth/totp/disable', 'post'],
```

- [ ] **Step 7: Run the openapi test to confirm it still passes**

Run: `npx vitest run tests/unit/openapi.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add app/api/v1/auth/totp/disable/route.ts tests/integration/totp-disable.test.ts \
  lib/api/openapi.ts tests/unit/openapi.test.ts
git commit -m "feat: add POST /api/v1/auth/totp/disable"
```

---

### Task 6: Add the `qrcode` dependency and the `PasswordSettings` component

**Files:**

- Modify: `package.json` (via `npm install`)
- Create: `components/PasswordSettings.tsx`
- Create: `tests/ui/password-settings.test.tsx`

**Interfaces:**

- Produces: `PasswordSettings` — a default-exportless named React component (`export function PasswordSettings()`), no props, self-contained (own fetch calls, own state). Renders a `<Card>` with a form calling `PATCH /api/v1/auth/password`.

- [ ] **Step 1: Install the QR code dependency**

```bash
npm install qrcode
npm install -D @types/qrcode
```

Run: `git diff package.json` — expect `qrcode` added under `dependencies` and `@types/qrcode` under `devDependencies`, and `package-lock.json` updated.

- [ ] **Step 2: Write the failing UI test — `tests/ui/password-settings.test.tsx`**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@testing-library/react';
import { PasswordSettings } from '@/components/PasswordSettings';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PasswordSettings', () => {
  it('refuses to submit when the new passwords do not match (no fetch)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<PasswordSettings />);
    await userEvent.type(screen.getByLabelText(/current password/i), 'password12345');
    await userEvent.type(screen.getByLabelText(/^new password$/i), 'new-password-999');
    await userEvent.type(screen.getByLabelText(/confirm new password/i), 'different');
    await userEvent.click(screen.getByRole('button', { name: /change password/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('New passwords do not match.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('PATCHes /api/v1/auth/password and shows a success message', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<PasswordSettings />);
    await userEvent.type(screen.getByLabelText(/current password/i), 'password12345');
    await userEvent.type(screen.getByLabelText(/^new password$/i), 'new-password-999');
    await userEvent.type(screen.getByLabelText(/confirm new password/i), 'new-password-999');
    await userEvent.click(screen.getByRole('button', { name: /change password/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/other sessions/i);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/auth/password');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({
      currentPassword: 'password12345',
      newPassword: 'new-password-999',
    });
  });

  it('shows the error envelope message when the current password is wrong', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: 'CURRENT_PASSWORD_INVALID', message: 'Current password is incorrect.' },
          }),
          { status: 400 }
        )
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<PasswordSettings />);
    await userEvent.type(screen.getByLabelText(/current password/i), 'wrong');
    await userEvent.type(screen.getByLabelText(/^new password$/i), 'new-password-999');
    await userEvent.type(screen.getByLabelText(/confirm new password/i), 'new-password-999');
    await userEvent.click(screen.getByRole('button', { name: /change password/i }));
    await waitFor(async () => {
      expect(await screen.findByRole('alert')).toHaveTextContent('Current password is incorrect.');
    });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/ui/password-settings.test.tsx`
Expected: FAIL — `Cannot find module '@/components/PasswordSettings'`

- [ ] **Step 4: Implement the component — `components/PasswordSettings.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

export function PasswordSettings() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (newPassword !== confirm) {
      setError('New passwords do not match.');
      return;
    }
    setBusy(true);
    const res = await fetch('/api/v1/auth/password', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? 'Failed to change password.');
      return;
    }
    setCurrentPassword('');
    setNewPassword('');
    setConfirm('');
    setSuccess(true);
  }

  return (
    <Card>
      <h2 className="wght-540 mb-4 text-[20px] tracking-[-0.4px]">Password</h2>
      <form onSubmit={onSubmit} className="flex max-w-sm flex-col gap-4">
        <label className="text-sm text-ink-mute">
          Current password
          <Input
            type="password"
            value={currentPassword}
            onChange={e => setCurrentPassword(e.target.value)}
            required
          />
        </label>
        <label className="text-sm text-ink-mute">
          New password
          <Input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            minLength={10}
            required
          />
        </label>
        <label className="text-sm text-ink-mute">
          Confirm new password
          <Input
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            required
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-ink">
            {error}
          </p>
        )}
        {success && (
          <p role="status" className="text-sm text-ink">
            Password changed. Your other sessions have been signed out.
          </p>
        )}
        <Button type="submit" disabled={busy}>
          Change password
        </Button>
      </form>
    </Card>
  );
}
```

- [ ] **Step 5: Run the test again to verify it passes**

Run: `npx vitest run tests/ui/password-settings.test.tsx`
Expected: PASS (all 3 tests)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json components/PasswordSettings.tsx tests/ui/password-settings.test.tsx
git commit -m "feat: add PasswordSettings component and the qrcode dependency"
```

---

### Task 7: Add the `TotpSettings` component (enroll → confirm → enabled → disable)

**Files:**

- Create: `components/TotpSettings.tsx`
- Create: `tests/ui/totp-settings.test.tsx`

**Interfaces:**

- Consumes: the `qrcode` package's default export (`QRCode.toDataURL(uri): Promise<string>`), installed in Task 6.
- Produces: `TotpSettings` — `export function TotpSettings({ initialEnabled }: { initialEnabled: boolean })`. Calls `POST /api/v1/auth/totp/enroll`, `POST /api/v1/auth/totp/enable`, `POST /api/v1/auth/totp/disable` (all from Task 5 / existing routes).

- [ ] **Step 1: Write the failing UI test — `tests/ui/totp-settings.test.tsx`**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TotpSettings } from '@/components/TotpSettings';

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async () => 'data:image/png;base64,mock-qr') },
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TotpSettings', () => {
  it('shows a "Set up 2FA" button when not enabled', () => {
    render(<TotpSettings initialEnabled={false} />);
    expect(screen.getByRole('button', { name: /set up 2fa/i })).toBeInTheDocument();
  });

  it('enrolls, shows the QR code and secret, then enables on a correct code', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/totp/enroll')) {
        return new Response(
          JSON.stringify({
            secret: 'ABCDEFGHIJKLMNOP',
            otpauthUri: 'otpauth://totp/GEM-ZT:admin?secret=ABCDEFGHIJKLMNOP',
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ enabled: true }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<TotpSettings initialEnabled={false} />);
    await userEvent.click(screen.getByRole('button', { name: /set up 2fa/i }));

    expect(await screen.findByText('ABCDEFGHIJKLMNOP')).toBeInTheDocument();
    expect(await screen.findByAltText(/2fa qr code/i)).toHaveAttribute(
      'src',
      'data:image/png;base64,mock-qr'
    );

    await userEvent.type(screen.getByLabelText(/6-digit code/i), '123456');
    await userEvent.click(screen.getByRole('button', { name: /confirm and enable/i }));

    await waitFor(() => {
      const enableCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/totp/enable'));
      expect(enableCall).toBeDefined();
      expect(JSON.parse((enableCall![1] as RequestInit).body as string)).toEqual({
        code: '123456',
      });
    });
    expect(await screen.findByText(/is enabled/i)).toBeInTheDocument();
  });

  it('shows an error when confirming with a wrong code', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/totp/enroll')) {
        return new Response(
          JSON.stringify({
            secret: 'ABCDEFGHIJKLMNOP',
            otpauthUri: 'otpauth://totp/GEM-ZT:admin?secret=ABCDEFGHIJKLMNOP',
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          error: { code: 'INVALID_TOTP', message: 'Invalid or expired TOTP code.' },
        }),
        { status: 400 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<TotpSettings initialEnabled={false} />);
    await userEvent.click(screen.getByRole('button', { name: /set up 2fa/i }));
    await screen.findByText('ABCDEFGHIJKLMNOP');
    await userEvent.type(screen.getByLabelText(/6-digit code/i), '000000');
    await userEvent.click(screen.getByRole('button', { name: /confirm and enable/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid or expired TOTP code.');
  });

  it('disables 2FA with the current password when enabled', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ enabled: false }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<TotpSettings initialEnabled={true} />);
    expect(screen.getByText(/is enabled/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/current password/i), 'password12345');
    await userEvent.click(screen.getByRole('button', { name: /disable 2fa/i }));

    await waitFor(() => {
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/v1/auth/totp/disable');
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        currentPassword: 'password12345',
      });
    });
    expect(await screen.findByRole('button', { name: /set up 2fa/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ui/totp-settings.test.tsx`
Expected: FAIL — `Cannot find module '@/components/TotpSettings'`

- [ ] **Step 3: Implement the component — `components/TotpSettings.tsx`**

```tsx
'use client';

import { useState } from 'react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

export function TotpSettings({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [secret, setSecret] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function startEnroll() {
    setError(null);
    setBusy(true);
    const res = await fetch('/api/v1/auth/totp/enroll', { method: 'POST' });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? 'Failed to start 2FA enrollment.');
      return;
    }
    const body = await res.json();
    setSecret(body.secret);
    setQrDataUrl(await QRCode.toDataURL(body.otpauthUri));
  }

  async function confirmEnroll(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await fetch('/api/v1/auth/totp/enable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? 'Invalid or expired code.');
      return;
    }
    setEnabled(true);
    setSecret(null);
    setQrDataUrl(null);
    setCode('');
  }

  async function disable(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await fetch('/api/v1/auth/totp/disable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: disablePassword }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? 'Failed to disable 2FA.');
      return;
    }
    setEnabled(false);
    setDisablePassword('');
  }

  return (
    <Card>
      <h2 className="wght-540 mb-4 text-[20px] tracking-[-0.4px]">Two-Factor Authentication</h2>
      {error && (
        <p role="alert" className="mb-4 text-sm text-ink">
          {error}
        </p>
      )}
      {enabled && !secret && (
        <div className="flex max-w-sm flex-col gap-4">
          <p className="text-sm text-ink-mute">Two-factor authentication is enabled.</p>
          <form onSubmit={disable} className="flex flex-col gap-4">
            <label className="text-sm text-ink-mute">
              Current password
              <Input
                type="password"
                value={disablePassword}
                onChange={e => setDisablePassword(e.target.value)}
                required
              />
            </label>
            <Button type="submit" variant="outline" disabled={busy}>
              Disable 2FA
            </Button>
          </form>
        </div>
      )}
      {!enabled && !secret && (
        <div>
          <p className="mb-4 text-sm text-ink-mute">Two-factor authentication is not enabled.</p>
          <Button onClick={startEnroll} disabled={busy}>
            Set up 2FA
          </Button>
        </div>
      )}
      {!enabled && secret && (
        <div className="flex max-w-sm flex-col gap-4">
          <p className="text-sm text-ink-mute">
            Scan this code with your authenticator app, or enter the key manually.
          </p>
          {qrDataUrl && <img src={qrDataUrl} alt="2FA QR code" width={200} height={200} />}
          <code className="break-all font-mono text-sm">{secret}</code>
          <form onSubmit={confirmEnroll} className="flex flex-col gap-4">
            <label className="text-sm text-ink-mute">
              6-digit code
              <Input value={code} onChange={e => setCode(e.target.value)} maxLength={6} required />
            </label>
            <Button type="submit" disabled={busy}>
              Confirm and enable
            </Button>
          </form>
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 4: Run the test again to verify it passes**

Run: `npx vitest run tests/ui/totp-settings.test.tsx`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add components/TotpSettings.tsx tests/ui/totp-settings.test.tsx
git commit -m "feat: add TotpSettings component (enroll, confirm, disable)"
```

---

### Task 8: Assemble the `/account` page, add nav link, run the full suite

**Files:**

- Create: `app/(ui)/account/page.tsx`
- Modify: `app/(ui)/layout.tsx`
- Create: `tests/ui/account-page.test.tsx`

**Interfaces:**

- Consumes: `PasswordSettings` (Task 6), `TotpSettings` (Task 7), `GET /api/v1/me` (Task 4, returns `{ user: { id, username, role, totpEnabled } }`).

- [ ] **Step 1: Write the failing UI test — `tests/ui/account-page.test.tsx`**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import AccountPage from '@/app/(ui)/account/page';

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async () => 'data:image/png;base64,mock-qr') },
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AccountPage', () => {
  it('loads the profile and renders username, password, and 2FA sections', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            user: { id: 'u1', username: 'admin', role: 'admin', totpEnabled: false },
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<AccountPage />);

    expect(await screen.findByText('admin')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /password/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /two-factor authentication/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set up 2fa/i })).toBeInTheDocument();
  });

  it('renders the 2FA section as enabled when the profile reports totpEnabled=true', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            user: { id: 'u1', username: 'admin', role: 'admin', totpEnabled: true },
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<AccountPage />);

    expect(await screen.findByText(/is enabled/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ui/account-page.test.tsx`
Expected: FAIL — `Cannot find module '@/app/(ui)/account/page'`

- [ ] **Step 3: Implement the page — `app/(ui)/account/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { PasswordSettings } from '@/components/PasswordSettings';
import { TotpSettings } from '@/components/TotpSettings';

interface Me {
  id: string;
  username: string;
  role: string;
  totpEnabled: boolean;
}

export default function AccountPage() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetch('/api/v1/me')
      .then(r => r.json())
      .then(d => setMe(d.user))
      .catch(() => {});
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="wght-540 text-[28px] tracking-[-0.63px]">Account</h1>

      <Card>
        <h2 className="wght-540 mb-4 text-[20px] tracking-[-0.4px]">Profile</h2>
        {me ? (
          <dl className="text-sm">
            <div className="flex gap-2">
              <dt className="text-ink-mute">Username</dt>
              <dd>{me.username}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-mute">Role</dt>
              <dd>{me.role}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-ink-mute">Loading…</p>
        )}
      </Card>

      <PasswordSettings />

      {me && <TotpSettings initialEnabled={me.totpEnabled} />}
    </div>
  );
}
```

- [ ] **Step 4: Run the test again to verify it passes**

Run: `npx vitest run tests/ui/account-page.test.tsx`
Expected: PASS (both tests)

- [ ] **Step 5: Add the nav link — `app/(ui)/layout.tsx`**

Change the `nav` array:

```ts
const nav = [
  { href: '/networks', label: 'Networks' },
  { href: '/pending', label: 'Pending' },
  { href: '/status', label: 'Status' },
  { href: '/apikeys', label: 'API Keys' },
  { href: '/audit', label: 'Audit Log' },
  { href: '/docs', label: 'API Docs' },
  { href: '/account', label: 'Account' },
];
```

- [ ] **Step 6: Run the full test suite, typecheck, and lint**

Run: `npm test`
Expected: PASS — every test file, including all files touched in Tasks 1–8

Run: `npm run typecheck`
Expected: no errors

Run: `npm run lint`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add "app/(ui)/account/page.tsx" "app/(ui)/layout.tsx" tests/ui/account-page.test.tsx
git commit -m "feat: add /account settings page (profile, password, 2FA) with nav link"
```
