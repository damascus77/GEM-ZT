# Account Settings & Frictionless Setup — Design

**Status:** Approved (design phase)
**Date:** 2026-07-04
**Author:** Noah + Claude

## 1. Summary

Two related changes to the auth system:

1. **Remove the setup-token requirement** on first account creation. Today
   `app/(auth)/setup/page.tsx` requires pasting a static `GEMZT_SETUP_TOKEN`
   (set manually in `.env`) before the first admin account can be created.
   Since setup is already only reachable while zero users exist in the DB,
   the token adds a manual step without adding meaningful protection for a
   single-admin self-hosted app. Drop it entirely.
2. **Add an account settings page** for the logged-in admin to change their
   password and manage TOTP-based 2FA. The TOTP backend (enroll/enable/login
   challenge) already exists and works; it just has no UI and no way to
   disable it. Password change doesn't exist at all yet.

Passkey/WebAuthn support is explicitly **out of scope** for this spec (see
§6) and will get its own design once this ships.

## 2. Decisions (locked)

| Area                   | Decision                                                                                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup token            | Removed entirely. `needsSetup` (zero users in DB) remains the sole gate on the setup endpoint. Existing per-IP rate limit (10/15min) stays as the anti-abuse guard.   |
| Password change        | Requires current password + new password (re-auth pattern). On success, all other sessions for that user are invalidated; the session making the request stays valid. |
| TOTP enable            | Reuses existing `enroll` + `enable` routes unchanged.                                                                                                                 |
| TOTP disable           | New route, requires current password to confirm.                                                                                                                      |
| Settings page location | Single page at `/account`, consistent with the existing one-page-per-concern pattern (`/networks`, `/apikeys`, `/audit`).                                             |
| Passkeys/WebAuthn      | Deferred to a follow-up spec (§6).                                                                                                                                    |

## 3. Setup token removal

**Changes:**

- `app/api/v1/setup/route.ts` — remove the `GEMZT_SETUP_TOKEN` env lookup and
  `timingSafeEqual` comparison. `needsSetup` (DB has zero users) remains the
  only precondition for account creation. Keep the existing per-IP rate limit.
- `app/api/v1/setup/status/route.ts` — drop `requiresToken` from the response.
- `app/(auth)/setup/page.tsx` — remove the token input field.
- `.env.example` — remove `GEMZT_SETUP_TOKEN`.
- `tests/integration/setup-token.test.ts` — deleted (the feature it tests no
  longer exists). Add a case to the remaining setup integration test
  confirming account creation succeeds with no token field submitted at all.

**Risk accepted:** on a freshly-started, unconfigured instance reachable by
someone other than the operator before the operator completes setup, that
other party could create the admin account first. This is an accepted
trade-off for a self-hosted single-admin tool — mitigated in practice by
controlling network exposure during initial deployment, not by an app-level
token.

## 4. Password change

**API:** `PATCH /api/v1/auth/password`, session-authenticated via
`requireAuth` (existing middleware in `lib/api/auth.ts`).

- Request body: `{ currentPassword: string, newPassword: string }`.
- Verify `currentPassword` against `user.passwordHash` via the existing
  `verifyPassword()` (`lib/services/auth.ts`).
- Validate `newPassword` against the same minimum-length rule already
  enforced at account creation.
- On success:
  - Hash the new password with the existing `hashPassword()` and update
    `user.passwordHash`.
  - Delete every `Session` row for this user except the session making the
    request (new `invalidateOtherSessions(userId, currentSessionId)` in
    `lib/services/auth.ts`).
  - Write an audit log entry (existing `audit` service, same pattern used
    elsewhere for account-affecting actions).
- Error responses: `401` if unauthenticated, `400 CURRENT_PASSWORD_INVALID`
  if the current password check fails, `400 PASSWORD_TOO_SHORT` if the new
  password fails validation.

**UI:** A form in the "Password" section of the account settings page —
current password, new password, confirm new password. Calls the route
above; shows inline field errors on failure and a success toast on success.
No redirect needed since the current session remains valid.

## 5. TOTP settings UI + disable endpoint

The enroll/enable backend (`app/api/v1/auth/totp/enroll/route.ts`,
`app/api/v1/auth/totp/enable/route.ts`) is unchanged and reused as-is.

**New API:** `POST /api/v1/auth/totp/disable`, session-authenticated.

- Request body: `{ currentPassword: string }`.
- Verify `currentPassword`; on success clear `user.totpSecret` and set
  `user.totpEnabled = false`; write an audit log entry.
- Error responses: `401` if unauthenticated, `400 CURRENT_PASSWORD_INVALID`,
  `409` if TOTP is not currently enabled.

**`GET /api/v1/me`** gains `totpEnabled` in its response (`lib/services` /
`app/api/v1/me/route.ts`) so the settings page knows which UI state to
render without a separate request.

**UI flow** (in the "Two-Factor Authentication" section of the account
settings page):

- `totpEnabled === false`: show a "Set up 2FA" button. Clicking it calls
  `POST /auth/totp/enroll`, then displays the returned QR code (rendered
  from `otpauthUri`) plus the raw secret as a manual-entry fallback, plus a
  6-digit confirmation input. Submitting the confirmation calls
  `POST /auth/totp/enable`; on success the section flips to the enabled
  state.
- `totpEnabled === true`: show "2FA is enabled" plus a "Disable 2FA" button.
  Clicking it prompts for the current password and calls
  `POST /auth/totp/disable`.

## 6. Page structure & navigation

A single new route, `app/(ui)/account/page.tsx`, with three stacked
sections:

1. **Profile** — read-only username and role (from `GET /api/v1/me`).
2. **Password** — the form from §4.
3. **Two-Factor Authentication** — the flow from §5.

Add a nav link to `/account` in the existing top-level nav
(`app/(ui)/layout.tsx`), alongside the links to `/networks`, `/apikeys`,
`/audit`, etc.

## 7. Testing plan

- `tests/integration/setup-token.test.ts` deleted; existing setup
  integration test gets a case confirming setup succeeds with no token
  field submitted.
- New `tests/integration/password-change.test.ts`: wrong current password
  rejected; successful change invalidates other sessions but not the
  current one; new password satisfies the minimum-length rule; audit log
  entry written.
- New `tests/integration/totp-disable.test.ts`: wrong password rejected;
  correct password disables TOTP and clears the secret; disabling when not
  enabled returns 409.
- Unit test for the new `invalidateOtherSessions` helper in
  `lib/services/auth.ts`.
- New `tests/ui/account-settings.test.tsx` covering the password form and
  the TOTP enroll → confirm → enabled, and enabled → disable, flows —
  mirroring the style of the existing `tests/ui/network-settings.test.tsx`.

## 8. Explicitly out of scope (deferred)

**Passkeys / WebAuthn.** Requires a new Prisma `Credential` model, a
WebAuthn library (e.g. `@simplewebauthn/server`), new registration and
authentication-ceremony routes, and login-flow changes to accept a passkey
as an alternative or additional second factor. This is a meaningfully
larger, independent piece of work with its own schema migration and will
get its own design/spec after this one ships.
