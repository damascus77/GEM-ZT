# GEM-ZT

A self-hosted [ZeroTier](https://www.zerotier.com/) network controller with a clean web GUI
and a documented REST API. Create networks, authorize members, assign IPs, edit managed
routes / DNS / flow rules, mint API keys, and read an audit log — all without depending on
my.zerotier.com.

**This image is the `app` container only** — the web GUI and REST API. It is **not**
a standalone ZeroTier controller; it talks to one over HTTP, and it will not do anything
useful on its own. **This is a two-container deployment, not a single-image app** — see
[Deployment model](#deployment-model) before you run anything.

## Deployment model

GEM-ZT is always **two containers working together**, wired up in
[`docker-compose.yml`](docker-compose.yml). Pulling only the `app` image and running it
standalone will not work — there is no controller for it to talk to.

| Service               | Image                                                                          | Role                                                                 |
| ---------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `zerotier-controller` | [`zyclonite/zerotier:1.14.2`](https://hub.docker.com/r/zyclonite/zerotier)      | The actual ZeroTier network controller. Owns the controller identity and every network definition. Third-party image — GEM-ZT does not build or publish it. |
| `app`                  | This project's published image                                                  | The GUI + REST API. Talks to the controller's local HTTP API and mirrors its auth token; has no controller logic of its own. |

Three things tie the two containers together, and all three matter for a correct deployment:

1. **Startup ordering, via healthcheck.** `app` declares `depends_on: zerotier-controller:
   condition: service_healthy`. The controller's healthcheck (`test -s
   /var/lib/zerotier-one/authtoken.secret`) only passes once it has generated its auth token —
   `app` needs that token to authenticate to the controller's local API, so it deliberately
   waits rather than racing the controller on first boot. If you orchestrate these containers
   with something other than Compose (Kubernetes, Nomad, plain `docker run`), you must
   replicate this ordering yourself — starting `app` before the controller's token exists will
   put the app in a degraded "controller unreachable" state until it retries successfully.

2. **A shared, read-only volume for the auth token.** `controller_data` (mounted read-write
   into the controller at `/var/lib/zerotier-one`) is also mounted **read-only** into `app` at
   `/controller`. That's how `app` reads `authtoken.secret` to authenticate — there's no
   network-based credential exchange, just a shared volume. `ZT_TOKEN_PATH` in `app` points at
   this mount.

3. **A private network path between the two containers.** `app` reaches the controller's local
   API at `ZT_CONTROLLER_URL=http://zerotier-controller:9993` — Compose's built-in DNS
   resolving the service name. If you split these across hosts, or run them without a shared
   Docker network, you must either publish 9993 from the controller and repoint
   `ZT_CONTROLLER_URL` at it, or provide equivalent name resolution.

`app` additionally has its own private volume, `app_data`, that the controller never touches
(see [Persistence](#persistence)).

## Requirements

| | |
| --- | --- |
| **Ports** | `3000/tcp` (GEM-ZT web GUI + API) · `9993/udp` (ZeroTier controller — must be reachable by member devices, not just the app) |
| **Volumes** | `app_data` (GEM-ZT's SQLite DB — private to `app`) · `controller_data` (ZeroTier controller identity + network defs — read-write in the controller, read-only in `app`; see [Deployment model](#deployment-model)) |
| **Env vars** | See [Configuration](#configuration) below. Compose sets sensible defaults; nothing is required to change for a first run. |

## Quick start

Save as `docker-compose.yml`:

```yaml
services:
  zerotier-controller:
    image: zyclonite/zerotier:1.14.2
    restart: unless-stopped
    environment:
      - ZT_OVERRIDE_LOCAL_CONF=true
      - ZT_ALLOW_MANAGEMENT_FROM=0.0.0.0/0
    volumes:
      - controller_data:/var/lib/zerotier-one
    ports:
      - '9993:9993/udp'
    healthcheck:
      test: ['CMD-SHELL', 'test -s /var/lib/zerotier-one/authtoken.secret']
      interval: 5s
      timeout: 3s
      retries: 12
      start_period: 10s

  app:
    image: ghcr.io/damascus77/gem-zt:latest
    restart: unless-stopped
    depends_on:
      zerotier-controller:
        condition: service_healthy
    environment:
      - DATABASE_URL=file:/data/gemzt.db
      - ZT_CONTROLLER_URL=http://zerotier-controller:9993
      - ZT_TOKEN_PATH=/controller/authtoken.secret
    volumes:
      - app_data:/data
      - controller_data:/controller:ro
    ports:
      - '3000:3000'

volumes:
  controller_data:
  app_data:
```

Then:

```bash
docker compose up -d
```

Open **http://localhost:3000** and complete the first-run setup wizard to create your admin
account.

> Building from source instead of pulling the published image? Clone this repo and run
> `docker compose up -d --build` — the `Dockerfile` in this repo builds the same `app` image.

---

## Persistence

Two named volumes hold **all** state; the containers themselves are disposable.

| Volume            | Mounted at (in `app`)     | Contents                                                                       | Losing it means                                                             |
| ------------------ | -------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `controller_data` | `/controller` (read-only) | Controller `identity.secret` + `controller.d/` network defs (owned by the `zerotier-controller` container) | **Unrecoverable** — the controller identity and every network's ID are gone |
| `app_data`         | `/data`                    | SQLite DB: admin users, API keys, friendly names/notes, audit log, rules source | Recoverable-ish — networks keep working; you re-run setup and lose metadata |

**The controller identity is irreplaceable.** `controller_data`'s `identity.secret` node ID
is the first 10 hex digits of _every_ network ID (nwid) the controller creates. If you lose
it, you can never recreate those networks with the same IDs — every device that joined them
is orphaned and must be re-provisioned onto brand-new networks.

**Never run `docker compose down -v`.** The `-v` flag deletes named volumes — i.e. it
destroys the controller identity, every network, and all GEM-ZT metadata. Plain
`docker compose down` (no `-v`) is safe: it stops the containers but keeps the volumes.

### Backing up

Stop the stack first so the SQLite file and controller state are quiescent, then tar both
volumes (run from the project directory; substitute your actual volume names — Docker
prefixes them with the compose project name, e.g. `gemzt_controller_data`):

```bash
docker compose down            # stop containers; keeps volumes (NEVER add -v)

docker run --rm \
  -v gemzt_controller_data:/data -v "$PWD:/backup" \
  alpine tar czf /backup/gemzt-controller_data.tgz -C /data .

docker run --rm \
  -v gemzt_app_data:/data -v "$PWD:/backup" \
  alpine tar czf /backup/gemzt-app_data.tgz -C /data .

docker compose up -d           # bring it back
```

This produces `gemzt-controller_data.tgz` and `gemzt-app_data.tgz` — store them somewhere
safe (off-box). The controller archive is the critical one.

> If you must back up without downtime, at minimum snapshot `controller_data` while stopped,
> and copy the SQLite DB with `sqlite3 /data/gemzt.db ".backup /backup/gemzt.db"` rather than
> a raw file copy (a hot `cp` of an active SQLite file can be corrupt).

### Restoring

Restore into fresh, empty volumes (stack down, volumes removed or new project), then start:

```bash
docker compose down

docker run --rm \
  -v gemzt_controller_data:/data -v "$PWD:/backup" \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/gemzt-controller_data.tgz -C /data"

docker run --rm \
  -v gemzt_app_data:/data -v "$PWD:/backup" \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/gemzt-app_data.tgz -C /data"

docker compose up -d
```

The controller comes back with the same identity, so existing member devices reconnect with
no changes on their side.

---

## Configuration

Environment variables for the `app` container (see [`.env.example`](.env.example) for the
full annotated list; compose sets sensible defaults for the first four):

| Var                            | Default                           | Purpose                                                                          |
| ------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------- |
| `DATABASE_URL`                 | `file:/data/gemzt.db`             | SQLite location (the `app_data` volume)                                          |
| `ZT_CONTROLLER_URL`            | `http://zerotier-controller:9993` | Controller local API base URL                                                    |
| `ZT_TOKEN_PATH`                 | `/controller/authtoken.secret`    | Read-only-mounted controller auth token                                          |
| `ZT_AUTH_TOKEN`                 | _(unset)_                          | Overrides the token file if set                                                  |
| `GEMZT_COOKIE_SECURE`          | `false`                            | Mark the session cookie `Secure` (HTTPS-only). Enable behind a TLS-terminating proxy |
| `GEMZT_TRUST_PROXY`            | `true`                             | Trust `X-Forwarded-For`/`X-Real-IP` for rate-limit keying (behind a reverse proxy) |
| `GEMZT_LOGIN_MAX_ATTEMPTS`     | `5`                                 | Failed-login rate limit per username within the window                          |
| `GEMZT_LOGIN_WINDOW_MS`        | `900000`                           | Window (ms) for the per-username login limiter                                  |
| `GEMZT_LOGIN_IP_MAX_ATTEMPTS`  | `20`                                | Failed-login rate limit per IP within the window (NAT-tolerant, complements the above) |
| `GEMZT_AUDIT_RETENTION_DAYS`   | `90`                                | Audit-log rows older than this are purged opportunistically                     |
| `GEMZT_SETUP_TOKEN`             | _(unset)_                          | If set, `POST /api/v1/setup` requires this value in `X-Setup-Token`. Recommended if the setup endpoint is reachable from untrusted networks |

## Upgrading

```bash
docker compose pull
docker compose up -d
```

(Or `docker compose up -d --build` if building from source.) Schema changes are applied
automatically with **`prisma migrate deploy`** at container startup — non-interactive, and it
only applies pending migrations, so a schema change can't crash-loop or silently drift the
deployment.

**One-time baseline for a deployment created before migrations existed.** If your `app_data`
DB was first created by an older image (which used `prisma db push`), it has no
migration-tracking table, and `migrate deploy` will fail with `P3005`
("database schema is not empty"). Baseline it once — **pull/build the new image first** so
the one-off container actually contains the migration (otherwise `migrate resolve` fails with
`P3017 migration could not be found`):

```bash
docker compose pull           # or `docker compose build` from source
docker compose run --rm app npx prisma migrate resolve --applied 20260703164130_init
docker compose up -d          # migrate deploy now sees the baseline and is a no-op
```

Fresh installs need nothing — `migrate deploy` creates the schema from scratch. If
`migrate resolve` reports `P3008 (already recorded as applied)`, the baseline is already
done — skip it and just run `docker compose up -d`.

---

## Security & exposure

The web panel is an admin surface for your controller — treat it like one.

- **Don't expose port 3000 directly to the internet or an untrusted LAN.** Put it behind a
  reverse proxy that terminates TLS and (ideally) adds its own auth. Everything, including the
  login password, is plain HTTP otherwise.
- **`/setup` is only reachable while no admin account exists.** It creates the first admin with
  no token or default password; once that account exists, the endpoint refuses every further
  request (`409 SETUP_ALREADY_COMPLETE`) — including if `app_data` is ever lost and setup
  silently re-opens, at which point whoever reaches the app first claims it again. Don't expose
  the panel to anyone you don't want to risk racing you to finish setup. Set `GEMZT_SETUP_TOKEN`
  to close that race if the app is reachable before you finish setup.
- API access uses `Authorization: Bearer ztk_…` keys (managed under **API Keys**) or the session
  cookie. Full API reference is served at `/api/v1/openapi.json` and rendered under **API Docs**.

---

## Users, Organizations & Roles

GEM-ZT supports multi-user deployments with organizations and role-based access control.

### Instance super-admin and organizations

The first user created during setup becomes an **instance super-admin** and is automatically
added as **owner** of a default "Default" organization. A super-admin is an operator-level
account that manages instance-global concerns:

- Controller status, backups, and metrics
- Creating and deleting organizations
- Viewing audit logs across all orgs

Any super-admin can create new organizations. Each organization is independent; networks,
members, API keys, and templates belong to a single organization.

### Per-organization roles

Within each organization, users hold one of four roles:

| Role       | Capabilities                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Viewer** | Read networks, members, and audit logs (read-only)                                                                                               |
| **Editor** | Create/edit networks, authorize members, write rules and templates                                                                               |
| **Admin**  | Editor capabilities, plus manage organization members & roles, create invitations, manage webhooks, create org-scoped API keys                   |
| **Owner**  | Admin capabilities, plus rename/delete the organization and grant/revoke the owner role. Only owners and super-admins may assign the owner role. |

### Multi-organization membership

A user can belong to multiple organizations simultaneously, with an independent role in each.
The app shell provides an **organization switcher** to change the active organization; all
views (networks, members, audit log) reflect the currently active organization. When a user
logs in, the active org defaults to their first membership or a previously saved choice.

### Onboarding

Two methods add users to an organization:

1. **Invite links** — An org admin or owner creates a time-limited invitation link (a hashed
   token, valid until expiration) and shares it out-of-band (e.g., chat, email). The link
   recipient opens it in a browser to preview the organization and role, then sets a
   username and password to join. Invitation delivery via email is a planned future feature.

2. **Direct user creation** — An org admin or owner creates a user directly by username and
   temporary password, assigning a role immediately. The user logs in with the temporary
   password and can then change it under **Account Settings**.

### API keys

API keys are now scoped to a single organization. When creating a key, you assign it a role
(constrained to ≤ your own role); the key then acts with that role in its bound organization.
Revoking a user's membership does not revoke their API keys — keys must be revoked explicitly.

### Upgrade and backfill

If you upgrade from a single-admin GEM-ZT deployment, the migration is automatic and
non-destructive:

- The existing admin becomes a super-admin and owner of the default organization
- All existing networks, API keys, templates, and audit entries are assigned to the default org
- No manual migration steps are required
- A new installation follows the same path: the setup user becomes a super-admin in a default
  organization from day one

---

## Known limitations

- **No SSO/OIDC yet.** Login is username/password only. The data model and auth layer are
  designed so OIDC can be added additively later without a migration, but it isn't available
  in this release.
- **No invite-email delivery.** Invitation links must be shared out-of-band (chat, email you
  send yourself, etc.) — the app doesn't send them for you.
- **Single controller only.** One `zerotier-controller` per GEM-ZT instance; there's no
  multi-controller or HA support.
- **No private root / custom planet.** Member devices still rely on ZeroTier's public root
  servers for initial rendezvous; the controller itself is self-hosted, but full independence
  from ZeroTier's infrastructure (a custom "planet") isn't supported yet.
- **Presence and metrics are sampled opportunistically**, not via a background scheduler —
  data only updates while a relevant page is open in a browser. Similarly, webhook events
  (e.g. "new unauthorized member") only fire while a member list is being viewed.
- **Backup/restore edge case:** a network with compiled rules but no stored `rulesSource`
  (e.g. rules pushed by a very old version) won't re-push rules on restore.

See [`TODO.md`](TODO.md) for the full backlog and roadmap.

---

## Development

```bash
npm install
npm test          # vitest (unit + integration + jsdom UI); the e2e suite is CI-gated
npm run build     # prisma generate + next build
```

See [`TODO.md`](TODO.md) for the backlog (known follow-ups, an issue review, and a feature
roadmap) and `docs/superpowers/` for the design spec and implementation plan.

## License

[MIT](LICENSE)
