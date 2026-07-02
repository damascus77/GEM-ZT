# GEM-ZT — Self-Hosted ZeroTier Network Controller — Design

**Status:** Approved (design phase)
**Date:** 2026-07-02
**Author:** Noah + Claude

## 1. Summary

GEM-ZT is a self-hosted web GUI and REST API for controlling a private ZeroTier
network controller. It runs via Docker Compose and gives a single administrator a
clean, full-featured control panel over their own ZeroTier networks — without
depending on my.zerotier.com.

It is inspired by [ZTNET](https://github.com/Sinamics/ztnet) but scoped for
personal/internal use first, prioritizing **stability, simplicity, a clean
UI/UX, full ZeroTier controller coverage, and an API-first design**.

### Core principles

- **Stability** — the ZeroTier controller remains authoritative; GEM-ZT never
  becomes a single point of failure for network operation.
- **Simple to use** — one `docker compose up -d`, a first-run setup wizard, no
  hand-editing of config files.
- **Clean UI/UX** — driven by the Superhuman-inspired design system in
  `DESIGN.md`.
- **Full featured** — everything the ZeroTier controller can do (networks,
  members, IP assignment, managed routes, flow rules, DNS).
- **API accessible** — a first-class, documented REST API; the UI consumes the
  same API.

## 2. Background — how ZeroTier controllers work

- ZeroTier is a software-defined overlay network. Devices run `zerotier-one` and
  join a network by its 16-digit Network ID. Traffic is P2P and end-to-end
  encrypted.
- A **network controller** is itself a ZeroTier node; network IDs are derived
  from the controller's node ID. The controller is the authority for membership
  authorization, IP assignment, managed routes, flow rules, and DNS push.
- `zerotier-one` exposes a **local JSON HTTP API on port 9993**, authenticated
  with the token in `authtoken.secret`, sent as the `X-ZT1-AUTH` header. Key
  endpoints:
  - `GET /status` — node id, version, online state
  - `GET /controller/network` — list networks
  - `POST /controller/network/{nodeid}______` — create network
  - `GET/POST /controller/network/{nwid}` — network config
  - `GET/POST /controller/network/{nwid}/member/{memberId}` — member config
  - `GET /peer` — peer/presence info used for live status
- Persistent controller state lives in `/var/lib/zerotier-one` — notably
  `identity.secret` and `controller.d/`. Backing these up preserves the
  controller identity and all networks.

The local API has no user accounts, no friendly names, and no UI. GEM-ZT fills
that gap.

## 3. Decisions (locked)

| Area | Decision |
|---|---|
| v1 scope | Core + power features, single admin (no multi-tenancy yet) |
| Stack | Next.js 14 (App Router) + TypeScript + Tailwind + Prisma + **SQLite** |
| App structure | Route Handlers **are** the REST API; UI consumes `/api/v1/*` |
| Controller packaging | Separate official `zerotier-one` container |
| Audience | Personal / internal use first |
| Public API | Full documented REST API from day one (OpenAPI), API-key auth |
| Auth | Username + password (argon2) login, DB-backed sessions, + API keys |
| First run | Setup wizard creates the admin account (no default/env password) |
| Live status | Polling (react-query `refetchInterval`) |
| Project name | **GEM-ZT** |

## 4. Architecture

### 4.1 Deployment topology (docker-compose)

Two services + named volumes; `docker compose up -d`:

- **`zerotier-controller`** — official `zerotier-one` image.
  - Persists `/var/lib/zerotier-one` → `controller_data` volume (identity +
    `controller.d/`).
  - Publishes **UDP 9993** to the host so overlay members can reach the
    controller.
- **`app`** — the GEM-ZT Next.js app.
  - Reaches the controller's local API at `http://zerotier-controller:9993` over
    the internal Docker network.
  - Mounts `controller_data` **read-only** at a known path to read
    `authtoken.secret` (no secret duplication).
  - Persists SQLite to `app_data` volume.
  - Publishes **TCP 3000** to the host (intended to sit behind the user's own
    reverse proxy for TLS).

Configuration via `.env` (app port, controller service URL override, session
secret, etc.).

### 4.2 Internal layering (isolated, independently testable units)

- **Controller client** (`lib/controller/`) — typed wrapper over the
  `zerotier-one` JSON API. Sole responsibility: translate to/from controller
  JSON and attach `X-ZT1-AUTH`. Dependency: HTTP + token reader. Mockable.
- **Domain services** (`lib/services/`) — `networks`, `members`, `auth`,
  `apiKeys`, `audit`. Enforce the source-of-truth rules and orchestrate the
  controller client + DB. Depend on the controller client and Prisma.
- **REST layer** (`app/api/v1/`) — Route Handlers + auth middleware (accepts a
  session cookie **or** an API key). This is the public API.
- **Data layer** (`lib/db/`, Prisma) — SQLite.
- **Web UI** (`app/(ui)/`) — App Router pages styled from `DESIGN.md` tokens,
  calling `/api/v1`.

### 4.3 Source-of-truth rule (basis of "stability")

- **The controller is authoritative** for all real network config: membership /
  authorization, IP assignments, managed routes, flow rules, DNS.
- **GEM-ZT's DB only augments** — friendly names, descriptions, tags, notes —
  plus users, API keys, audit log, settings.
- **Writes go to the controller first, then upsert metadata.** Reads fetch live
  from the controller and join DB metadata. If the DB is lost, networks keep
  working; only cosmetic metadata is gone (and is recoverable).

## 5. Data model (SQLite via Prisma)

- **User** — `id`, `username` (unique), `passwordHash` (argon2), `role`
  (`admin` for now), `createdAt`.
- **ApiKey** — `id`, `userId`, `name`, `prefix`, `hashedKey`, `lastUsedAt`,
  `createdAt`, `expiresAt?`. Full key (`ztk_…`) shown once at creation; only the
  hash is stored.
- **Session** — `id`, `userId`, `expiresAt`; referenced by an httpOnly cookie.
- **NetworkMeta** — `nwid` (PK), `name`, `description`, `tags` (JSON),
  `createdAt`.
- **MemberMeta** — composite PK (`nwid`, `memberId`), `name`, `notes`.
- **AuditLog** — `id`, `userId`, `action`, `targetType`, `targetId`,
  `detail` (JSON), `createdAt`.
- **Setting** — `key` (PK), `value`. For runtime-adjustable config (e.g.
  controller URL override).

## 6. REST API surface (v1)

All under `/api/v1`. JSON. Auth via session cookie or `Authorization: Bearer
ztk_…`. Errors use the envelope `{ "error": { "code": string, "message":
string } }`. Request bodies validated with zod.

- **Setup / auth**
  - `GET  /setup/status` — whether first-run setup is needed
  - `POST /setup` — create the initial admin (only when no users exist)
  - `POST /auth/login`, `POST /auth/logout`, `GET /me`
- **API keys**
  - `GET /apikeys`, `POST /apikeys` (returns full key once), `DELETE /apikeys/{id}`
- **Controller**
  - `GET /controller/status` — node id, version, online, address
- **Networks**
  - `GET /networks`, `POST /networks`
  - `GET /networks/{nwid}`, `PATCH /networks/{nwid}`, `DELETE /networks/{nwid}`
  - PATCH covers: name/description/tags (metadata), `routes[]`,
    `ipAssignmentPools[]`, `v4AssignMode`, `v6AssignMode`, `dns`
    (`{ domain, servers[] }`), `private`, `enableBroadcast`, `mtu`, `multicast*`.
- **Members**
  - `GET /networks/{nwid}/members`
  - `GET /networks/{nwid}/members/{memberId}`,
    `PATCH /networks/{nwid}/members/{memberId}` (authorize, `ipAssignments[]`,
    `name`, `notes`, `activeBridge`, capabilities/tags),
    `DELETE /networks/{nwid}/members/{memberId}`
- **Flow rules**
  - `GET /networks/{nwid}/rules`, `PUT /networks/{nwid}/rules`
  - The ZeroTier controller stores compiled rules JSON. GEM-ZT ports ZeroTier's
    rules-compiler so the UI can offer a friendly editor **and** a raw
    source/JSON mode. `PUT` accepts rules source, compiles, and stores.
- **OpenAPI**
  - `GET /openapi.json` and a docs page render the spec.

## 7. Live status (polling)

- UI uses react-query (or SWR) with `refetchInterval` against the read
  endpoints.
- Presence, last-seen, physical address, and latency are derived by joining
  controller member data (`lastAuthorizedTime`, `physicalAddress`) with the
  node's `/peer` list where available. If a datum isn't exposed by the
  controller, the UI shows "unknown" rather than fabricating it.

## 8. Error handling & edge cases

- **Controller unreachable** → API returns `502` with a structured error; UI
  shows a persistent "controller degraded" banner and disables writes.
- **Controller write succeeds but metadata upsert fails** → logged; a
  non-blocking warning is surfaced. Controller is source of truth, so the
  operation is still correct.
- **Auth token missing/invalid at boot** → app starts but reports controller
  connectivity as failed with actionable guidance.
- **First-run race** → `POST /setup` is a no-op error once any user exists.
- All external input validated with zod at the API boundary.

## 9. Testing strategy (TDD)

- **Unit** — controller client (mock `fetch`); domain services (mock controller
  client + temp SQLite); rules-compiler (fixtures from ZeroTier rule sources).
- **Integration** — `/api/v1` Route Handlers against a temp SQLite DB with a
  mocked controller client; covers auth, validation, and error envelopes.
- **Optional e2e (CI)** — bring up a real `zerotier-one` controller container and
  exercise create-network → authorize-member → assign-IP.
- Follow the TDD skill: write the failing test first for each unit.

## 10. Build order (phases within v1)

1. **Foundation** — compose stack (both services + volumes), controller client,
   Prisma/SQLite schema, auth + first-run setup wizard, base layout wired to
   `DESIGN.md` tokens.
2. **Core** — networks CRUD, member list/detail, authorization, IP assignment,
   live-status polling.
3. **Power** — managed routes + IP assignment pools, DNS push, flow-rule editor
   (friendly + raw).
4. **API polish** — API-key management UI, OpenAPI spec + docs page, audit log
   view.

## 11. Out of scope for v1 (future)

- Multi-user, organizations/teams, roles, invitations.
- OAuth / external identity providers.
- Central config backup/restore UI (controller volume backup is documented
  manually instead).
- High-availability / multiple controllers.

## 12. Open items to confirm during planning

- Exact official ZeroTier image tag/base to standardize on.
- Whether to vendor ZeroTier's rules-compiler source or reimplement a subset.
- Session library vs. hand-rolled DB sessions (lean toward a small, audited
  library).
